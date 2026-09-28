import { z } from "zod";
import { id, now, tx, owned, parse } from "./db.mjs";
import { hash } from "./security.mjs";
export const inputSchema = z
  .object({
    text: z.string().trim().max(60000).default(""),
    url: z.string().trim().max(2000).default(""),
    urlMode: z.enum(["read", "reference"]).default("read"),
    images: z
      .array(
        z.object({
          name: z.string().max(120),
          data: z
            .string()
            .max(2900000)
            .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/),
        }),
      )
      .max(4)
      .default([]),
    question: z.string().trim().max(2000).default(""),
    app: z.string().max(80).default("Fenext"),
    title: z.string().max(200).optional(),
  })
  .refine((v) => v.text || v.url || v.images.length, "请提交链接、文字或图片")
  .refine(
    (v) => v.urlMode !== "reference" || v.text || v.images.length,
    "链接仅作为来源记录时，请粘贴正文或添加图片",
  );
export const noteJSON = (n) => ({
  ...n,
  aliases: parse(n.aliases, []),
  questions: parse(n.questions, []),
});
// Group only confirmed matching content. Questions, titles and image filenames
// do not identify material; the original task snapshots remain independent.
export function materialIdentity(t) {
  const input = parse(t.input);
  const checkpoint = parse(t.checkpoint);
  let url = input.url || "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    url = parsed.href;
  } catch {}
  const sourceKey = url ? hash(url) : null;
  const needsRead = url && input.urlMode !== "reference";
  if (needsRead && (!checkpoint.read?.length || checkpoint.sourceIssue))
    return { key: t.id, sourceKey, verified: false };
  const texts = needsRead
    ? checkpoint.read.filter((r) => r.kind !== "image").map((r) => r.content)
    : input.text
      ? [input.text]
      : [];
  const images = (input.images || []).map((i) => hash(i.data));
  if (!texts.length && !images.length)
    return { key: t.id, sourceKey, verified: false };
  const key = hash(JSON.stringify([url, texts, images]));
  return { key, sourceKey: sourceKey || key, verified: true };
}
export const taskJSON = (t) => {
  const input = parse(t.input);
  return {
    ...t,
    material: materialIdentity(t),
    input: {
      ...input,
      images: input.images.map((i, index) => ({ name: i.name, index })),
    },
    checkpoint: parse(t.checkpoint),
    result: parse(t.result),
    lease: undefined,
    fingerprint: undefined,
  };
};
export function submit(db, userId, raw, key) {
  const input = inputSchema.parse(raw);
  if (!key || key.length > 160)
    throw Object.assign(new Error("缺少有效的重复请求标识"), { status: 400 });
  for (const im of input.images) {
    const b = Buffer.from(im.data.split(",")[1], "base64");
    if (b.length > 2 * 1024 * 1024)
      throw Object.assign(new Error("每张图片不得超过 2 MB"), { status: 400 });
    const valid = im.data.startsWith("data:image/png")
      ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : im.data.startsWith("data:image/jpeg")
        ? b[0] === 255 && b[1] === 216
        : b.subarray(0, 4).toString() === "RIFF" &&
          b.subarray(8, 12).toString() === "WEBP";
    if (!valid)
      throw Object.assign(new Error("图片内容与类型不匹配"), { status: 400 });
  }
  if (input.url) {
    const u = new URL(input.url);
    if (!["https:", "http:"].includes(u.protocol))
      throw Object.assign(new Error("链接必须使用 HTTP(S)"), { status: 400 });
    u.hash = "";
    input.url = u.href;
  }
  const fingerprint = hash(
    JSON.stringify([
      input.text,
      input.url,
      input.images.map((i) => hash(i.data)),
      input.question,
      ...(input.urlMode === "reference" ? ["reference"] : []),
    ]),
  );
  return tx(db, () => {
    const receipt = db
      .prepare("SELECT * FROM receipts WHERE user_id=? AND request_key=?")
      .get(userId, key);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw Object.assign(new Error("同一提交标识不能用于不同资料"), {
          status: 409,
        });
      return owned(db, "tasks", receipt.task_id, userId);
    }
    let task = db
      .prepare("SELECT * FROM tasks WHERE user_id=? AND fingerprint=?")
      .get(userId, fingerprint);
    if (!task) {
      const taskId = id(),
        time = now();
      const configured = db
        .prepare("SELECT validated FROM settings WHERE user_id=?")
        .get(userId)?.validated;
      db.prepare(
        "INSERT INTO tasks(id,user_id,fingerprint,title,input,question,app,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        taskId,
        userId,
        fingerprint,
        input.title ||
          input.text.slice(0, 70) ||
          input.url ||
          input.images[0].name,
        JSON.stringify(input),
        input.question,
        input.app,
        configured ? "queued" : "waiting_config",
        time,
        time,
      );
      task = owned(db, "tasks", taskId, userId);
    }
    db.prepare("INSERT INTO receipts VALUES(?,?,?,?)").run(
      userId,
      key,
      task.id,
      fingerprint,
    );
    return task;
  });
}
export function saveVersion(db, note, body, reason, actor) {
  const version = note.version + 1;
  const r = db
    .prepare(
      "UPDATE notes SET body=?,version=?,updated_at=? WHERE id=? AND user_id=? AND version=?",
    )
    .run(body, version, now(), note.id, note.user_id, note.version);
  if (!r.changes)
    throw Object.assign(new Error("笔记版本已变化，改动已保留，请重新比较"), {
      status: 409,
    });
  db.prepare("INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)").run(
    id(),
    note.id,
    note.user_id,
    version,
    body,
    reason,
    actor,
    now(),
  );
  return owned(db, "notes", note.id, note.user_id);
}
export function splitSections(body) {
  return body.split(/(?=^##\s)/m).filter(Boolean);
}
export function makeItems(before, after) {
  const old = splitSections(before),
    next = splitSections(after);
  const key = (s) => s.match(/^##\s+(.+)/)?.[1] || "简介";
  if (
    new Set(old.map(key)).size !== old.length ||
    new Set(next.map(key)).size !== next.length
  )
    return [{ id: id(), heading: "正文", before, after, status: "pending" }];
  const keys = [...new Set([...old.map(key), ...next.map(key)])];
  return keys
    .map((k) => ({
      id: id(),
      heading: k,
      before: old.find((s) => key(s) === k) || "",
      after: next.find((s) => key(s) === k) || "",
      status: "pending",
    }))
    .filter((i) => i.before !== i.after);
}
export function suggestion(db, note, newBody, reason, taskId = null) {
  const items = makeItems(note.body, newBody);
  if (!items.length) return null;
  const sid = id();
  db.prepare("INSERT INTO suggestions VALUES(?,?,?,?,?,?,?,?,?)").run(
    sid,
    note.user_id,
    note.id,
    taskId,
    note.version,
    JSON.stringify(items),
    reason,
    "pending",
    now(),
  );
  return sid;
}
export function applySuggestion(db, userId, sid, selections, edited = {}) {
  return tx(db, () => {
    const s = owned(db, "suggestions", sid, userId),
      n = owned(db, "notes", s.note_id, userId);
    if (s.status !== "pending")
      throw Object.assign(new Error("建议已处理"), { status: 409 });
    if (n.version !== s.base_version)
      throw Object.assign(
        new Error("笔记在生成建议后发生了变化；原建议已保留，请重新比较"),
        { status: 409 },
      );
    const items = parse(s.items);
    if (
      !Array.isArray(selections) ||
      !selections.length ||
      selections.some(
        (v) => !items.find((i) => i.id === v && i.status === "pending"),
      )
    )
      throw Object.assign(new Error("请选择有效的待查看改动"), { status: 400 });
    let body = n.body;
    for (const i of items.filter((i) => selections.includes(i.id))) {
      const after = typeof edited[i.id] === "string" ? edited[i.id] : i.after;
      if (after.length > 100000)
        throw Object.assign(new Error("建议内容过长"), { status: 400 });
      if (i.before) {
        if (
          body.indexOf(i.before) === -1 ||
          body.indexOf(i.before) !== body.lastIndexOf(i.before)
        )
          throw Object.assign(new Error("无法唯一定位修改位置，请重新比较"), {
            status: 409,
          });
        body = body.replace(i.before, () => after);
      } else body += "\n" + after;
      i.after = after;
      i.status = "accepted";
    }
    const updated = saveVersion(db, n, body, s.reason, "review");
    db.prepare(
      "UPDATE suggestions SET items=?,base_version=?,status=? WHERE id=?",
    ).run(
      JSON.stringify(items),
      updated.version,
      items.every((i) => i.status !== "pending") ? "accepted" : "pending",
      sid,
    );
    return updated;
  });
}
