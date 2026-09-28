import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";
import { openDB, id, now, tx, owned, parse } from "./db.mjs";
import { analyze } from "./ai.mjs";
import { readMaterial } from "./reader.mjs";
import { suggestion } from "./domain.mjs";
import {
  isBlockedWechatRead,
  archiveBlockedCheckpoint,
  sourceBlockedMessage,
} from "./source-access.mjs";
export function claim(db) {
  return tx(db, () => {
    const t = db
      .prepare(
        "SELECT * FROM tasks WHERE (stage IN ('queued','reading','extracting','comparing')) AND next_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY created_at LIMIT 1",
      )
      .get(Date.now(), Date.now());
    if (!t) return null;
    if (t.attempts >= config.maxAttempts && !parse(t.checkpoint, {}).analysis) {
      db.prepare(
        "UPDATE tasks SET stage='failed',error='自动恢复次数已达上限；已保留阶段成果，可手动重试',lease=NULL,lease_until=NULL,updated_at=? WHERE id=?",
      ).run(now(), t.id);
      return null;
    }
    const lease = id();
    db.prepare(
      "UPDATE tasks SET lease=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?",
    ).run(lease, Date.now() + 120000, now(), t.id);
    return { ...t, lease, attempts: t.attempts + 1 };
  });
}
function checkpoint(db, t, stage, data) {
  const r = db
    .prepare(
      "UPDATE tasks SET stage=?,checkpoint=?,updated_at=? WHERE id=? AND lease=? AND stage NOT IN ('cancelled','deleted')",
    )
    .run(stage, JSON.stringify(data), now(), t.id, t.lease);
  if (!r.changes)
    throw Object.assign(new Error("任务已取消或由其他工作进程接管"), {
      cancelled: true,
    });
}
export function persistAnalysis(db, t, output) {
  return tx(db, () => {
    const current = db
      .prepare("SELECT * FROM tasks WHERE id=? AND user_id=?")
      .get(t.id, t.user_id);
    if (
      !current ||
      ["cancelled", "deleted"].includes(current.stage) ||
      current.lease !== t.lease
    )
      return;
    const result = {
      new: [],
      existing: [],
      updates: [],
      uncertain: [],
      summary: output.summary,
    };
    for (const item of output.items) {
      if (item.kind === "uncertain" || item.kind === "disagreement") {
        result.uncertain.push(item);
        continue;
      }
      let note = item.noteId
        ? db
            .prepare("SELECT * FROM notes WHERE id=? AND user_id=?")
            .get(item.noteId, t.user_id)
        : null;
      if (item.kind !== "new" && !note) {
        result.uncertain.push({
          ...item,
          reason: "模型目标未匹配到当前知识库，等待核对",
        });
        continue;
      }
      if (item.kind === "new") {
        // Case-sensitive comparison deliberately keeps React and ReAct distinct.
        const collision = db
          .prepare("SELECT * FROM notes WHERE user_id=?")
          .all(t.user_id)
          .find(
            (n) =>
              n.title === item.title ||
              parse(n.aliases, []).includes(item.title),
          );
        if (collision) {
          result.uncertain.push({
            ...item,
            reason: "同名或别名知识已存在，需核对后决定合并",
          });
          continue;
        }
        const nid = id(),
          time = now();
        db.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
          nid,
          t.user_id,
          item.title,
          JSON.stringify(item.aliases),
          item.level,
          item.reason,
          JSON.stringify(item.questions),
          item.body,
          1,
          time,
          time,
        );
        db.prepare("INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)").run(
          id(),
          nid,
          t.user_id,
          1,
          item.body,
          "资料整理自动新增",
          "collection",
          time,
        );
        note = owned(db, "notes", nid, t.user_id);
        result.new.push({ id: nid, title: item.title });
      } else if (item.kind === "update") {
        // The comparison must be against the exact snapshot presented to the model.
        const snapshot = parse(current.checkpoint, {}).noteVersions?.[note.id];
        if (snapshot !== note.version) {
          result.uncertain.push({
            ...item,
            reason: "处理期间笔记已更新，建议正文已保留，需要重新比较",
          });
          continue;
        }
        const sid = suggestion(db, note, item.body, item.reason, t.id);
        if (sid)
          result.updates.push({ id: sid, noteId: note.id, title: note.title });
        else result.existing.push({ id: note.id, title: note.title });
      } else result.existing.push({ id: note.id, title: note.title });
      if (note)
        db.prepare("INSERT OR IGNORE INTO sources VALUES(?,?,?,?,?)").run(
          id(),
          t.user_id,
          note.id,
          t.id,
          item.evidence,
        );
    }
    db.prepare(
      "UPDATE tasks SET stage='completed',result=?,error=NULL,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease=?",
    ).run(JSON.stringify(result), now(), t.id, t.lease);
    return result;
  });
}
export async function runTask(
  db,
  t,
  { reader = readMaterial, analyzer = analyze } = {},
) {
  const heartbeat = setInterval(
    () =>
      db
        .prepare(
          "UPDATE tasks SET lease_until=? WHERE id=? AND lease=? AND stage NOT IN ('cancelled','deleted')",
        )
        .run(Date.now() + 120000, t.id, t.lease),
    30000,
  );
  heartbeat.unref();
  let cp = parse(t.checkpoint, {});
  try {
    if (cp.read?.some(isBlockedWechatRead)) {
      cp = archiveBlockedCheckpoint(cp);
      checkpoint(db, t, "reading", cp);
      throw Object.assign(new Error(sourceBlockedMessage), {
        code: "SOURCE_BLOCKED",
      });
    }
    if (!cp.read) {
      delete cp.sourceIssue;
      checkpoint(db, t, "reading", cp);
      cp.read = await reader(parse(t.input));
      checkpoint(db, t, "extracting", cp);
    }
    if (!cp.analysis) {
      cp.noteVersions = Object.fromEntries(
        db
          .prepare("SELECT id,version FROM notes WHERE user_id=?")
          .all(t.user_id)
          .map((n) => [n.id, n.version]),
      );
      checkpoint(db, t, "extracting", cp);
      cp.analysis = await analyzer(db, t, cp.read);
      checkpoint(db, t, "comparing", cp);
    }
    persistAnalysis(db, t, cp.analysis);
  } catch (e) {
    if (!e.cancelled) {
      const current = db
        .prepare("SELECT * FROM tasks WHERE id=? AND user_id=?")
        .get(t.id, t.user_id);
      if (
        current &&
        !["cancelled", "deleted"].includes(current.stage) &&
        current.lease === t.lease
      ) {
        if (e.code === "SOURCE_BLOCKED") {
          cp.sourceIssue = { code: e.code, url: e.url, message: e.message };
          checkpoint(db, t, "reading", cp);
        }
        const stage =
          e.code === "CONFIG"
            ? "waiting_config"
            : e.transient && t.attempts < config.maxAttempts
              ? "queued"
              : "failed";
        const message =
          e.name === "ZodError"
            ? "模型输出结构不符合要求，资料已保留"
            : e.message;
        db.prepare(
          "UPDATE tasks SET stage=?,error=?,lease=NULL,lease_until=NULL,next_at=?,updated_at=? WHERE id=? AND lease=?",
        ).run(
          stage,
          message,
          Date.now() + Math.min(60000, 2000 * 2 ** t.attempts),
          now(),
          t.id,
          t.lease,
        );
      }
    }
  } finally {
    clearInterval(heartbeat);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDB();
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  console.log("Fenext worker 已启动；等待已接收任务");
  while (!stopping) {
    const t = claim(db);
    if (t) await runTask(db, t);
    else await new Promise((r) => setTimeout(r, config.poll));
  }
  db.close();
}
