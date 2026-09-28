import test from "node:test";
import assert from "node:assert/strict";
import { fixture, insertNote, item } from "./helpers.mjs";
import {
  submit,
  applySuggestion,
  suggestion,
  saveVersion,
} from "../server/domain.mjs";
import { claim, runTask } from "../server/worker.mjs";
import { parse, owned, id, now, tx } from "../server/db.mjs";
import {
  encrypt,
  decrypt,
  publicAddress,
  providerURL,
} from "../server/security.mjs";
const reader = async () => [
  { kind: "text", range: "测试材料", content: "用于集成测试的资料。" },
];

test("请求幂等与资料去重分别生效，复用幂等键不能改输入", () => {
  const { db, uid } = fixture();
  const a = submit(db, uid, { text: "same" }, "a"),
    b = submit(db, uid, { text: "same" }, "b");
  assert.equal(a.id, b.id);
  assert.equal(submit(db, uid, { text: "same" }, "a").id, a.id);
  assert.throws(() => submit(db, uid, { text: "changed" }, "a"), /不同资料/);
  db.close();
});
test("缺少密钥仍持久保存资料并等待配置", () => {
  const { db, uid } = fixture();
  db.prepare("DELETE FROM settings").run();
  const t = submit(db, uid, { text: "待处理" }, "a");
  assert.equal(t.stage, "waiting_config");
  assert.equal(claim(db), null);
  db.close();
});
test("A/B 已有，只新增 C；B 产生建议但原文保持不变", async () => {
  const { db, uid } = fixture(),
    a = insertNote(db, uid, "ReAct"),
    b = insertNote(db, uid, "工具调用");
  submit(db, uid, { text: "A B C" }, "a");
  const t = claim(db);
  await runTask(db, t, {
    reader,
    analyzer: async () => ({
      summary: "混合知识",
      items: [
        item(a.title, "existing", a.id),
        item(
          b.title,
          "update",
          b.id,
          b.body + "\n## 新案例\n需要验证工具结果。",
        ),
        item("环境观察"),
      ],
    }),
  });
  const result = parse(owned(db, "tasks", t.id, uid).result);
  assert.equal(result.new.length, 1);
  assert.equal(result.existing.length, 1);
  assert.equal(result.updates.length, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes").get().n, 3);
  assert.equal(owned(db, "notes", b.id, uid).body, b.body);
  assert.equal(claim(db), null);
  db.close();
});
test("React 与 ReAct 不会按大小写折叠合并；同名新增保留待核对", async () => {
  const { db, uid } = fixture();
  insertNote(db, uid, "ReAct");
  submit(db, uid, { text: "React ReAct" }, "a");
  const t = claim(db);
  await runTask(db, t, {
    reader,
    analyzer: async () => ({
      summary: "区分语义",
      items: [item("React"), item("ReAct")],
    }),
  });
  const r = parse(owned(db, "tasks", t.id, uid).result);
  assert.equal(r.new.length, 1);
  assert.equal(r.uncertain.length, 1);
  db.close();
});
test("建议逐项接受产生版本，未接受项保留并可再次接受", () => {
  const { db, uid } = fixture(),
    n = insertNote(db, uid);
  const s = suggestion(
    db,
    n,
    n.body
      .replace("行动与观察。", "依据结果选择行动。")
      .replace("仍需额外停止机制。", "需要停止与验证机制。"),
    "补充",
  );
  let state = owned(db, "suggestions", s, uid);
  const items = parse(state.items);
  assert.equal(items.length, 2);
  applySuggestion(db, uid, s, [items[0].id]);
  state = owned(db, "suggestions", s, uid);
  assert.equal(state.status, "pending");
  assert.equal(state.base_version, 2);
  const updated = applySuggestion(db, uid, s, [items[1].id]);
  assert.equal(updated.version, 3);
  assert.equal(owned(db, "suggestions", s, uid).status, "accepted");
  assert.equal(db.prepare("SELECT count(*) AS n FROM versions").get().n, 3);
  db.close();
});
test("旧基准建议不能覆盖新版本；建议与双方成果保留", () => {
  const { db, uid } = fixture(),
    n = insertNote(db, uid),
    s = suggestion(db, n, "## 是什么\nAI 的新建议。", "test");
  tx(db, () => saveVersion(db, n, n.body + "\n用户新增。", "user", "obsidian"));
  const itemId = parse(owned(db, "suggestions", s, uid).items)[0].id;
  assert.throws(
    () => applySuggestion(db, uid, s, [itemId]),
    (e) => e.status === 409,
  );
  assert.match(owned(db, "notes", n.id, uid).body, /用户新增/);
  assert.equal(owned(db, "suggestions", s, uid).status, "pending");
  db.close();
});
test("任务处理中笔记变化时保留建议正文，不按新版本静默合并", async () => {
  const { db, uid } = fixture(),
    n = insertNote(db, uid);
  submit(db, uid, { text: "old source" }, "a");
  const t = claim(db);
  await runTask(db, t, {
    reader,
    analyzer: async () => {
      tx(db, () => saveVersion(db, n, n.body + "用户修改", "edit", "obsidian"));
      return {
        summary: "更新",
        items: [item(n.title, "update", n.id, n.body + "AI 修改")],
      };
    },
  });
  const r = parse(owned(db, "tasks", t.id, uid).result);
  assert.equal(r.updates.length, 0);
  assert.equal(r.uncertain.length, 1);
  assert.match(r.uncertain[0].body, /AI 修改/);
  db.close();
});
test("读取恢复点保存；重试不重新读取已完成阶段", async () => {
  const { db, uid } = fixture();
  submit(db, uid, { text: "checkpoint" }, "a");
  let reads = 0;
  await runTask(db, claim(db), {
    reader: async () => {
      reads++;
      return reader();
    },
    analyzer: async () => {
      throw new Error("模型暂时失败");
    },
  });
  const t = db.prepare("SELECT * FROM tasks").get();
  assert.ok(parse(t.checkpoint).read);
  db.prepare("UPDATE tasks SET stage='queued',next_at=0 WHERE id=?").run(t.id);
  await runTask(db, claim(db), {
    reader: async () => {
      reads++;
      return reader();
    },
    analyzer: async () => ({ summary: "没有知识", items: [] }),
  });
  assert.equal(reads, 1);
  assert.equal(owned(db, "tasks", t.id, uid).stage, "completed");
  db.close();
});
test("取消后的迟到 AI 响应不能入库或恢复任务", async () => {
  const { db, uid } = fixture();
  submit(db, uid, { text: "cancel" }, "a");
  const t = claim(db);
  await runTask(db, t, {
    reader,
    analyzer: async () => {
      db.prepare(
        "UPDATE tasks SET stage='cancelled',lease=NULL WHERE id=?",
      ).run(t.id);
      return { summary: "迟到响应", items: [item("不应保存")] };
    },
  });
  assert.equal(owned(db, "tasks", t.id, uid).stage, "cancelled");
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes").get().n, 0);
  db.close();
});
test("租约互斥与过期恢复，旧 worker 无权写结果", async () => {
  const { db, uid } = fixture();
  submit(db, uid, { text: "lease" }, "a");
  const old = claim(db);
  assert.equal(claim(db), null);
  db.prepare("UPDATE tasks SET lease_until=0").run();
  const fresh = claim(db);
  assert.notEqual(old.lease, fresh.lease);
  await runTask(db, old, {
    reader,
    analyzer: async () => ({ summary: "stale", items: [item("旧进程")] }),
  });
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes").get().n, 0);
  await runTask(db, fresh, {
    reader,
    analyzer: async () => ({ summary: "fresh", items: [item("新进程")] }),
  });
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes").get().n, 1);
  db.close();
});
test("另一账户不能操作笔记或建议", () => {
  const { db, uid } = fixture(),
    n = insertNote(db, uid),
    other = id();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    other,
    "other",
    "x",
    now(),
  );
  assert.throws(
    () => owned(db, "notes", n.id, other),
    (e) => e.status === 404,
  );
  db.close();
});
test("AES-GCM 密钥加密不回显，篡改后不可解密", () => {
  process.env.MASTER_KEY = "a".repeat(64);
  const cipher = encrypt("test-not-a-real-key");
  assert.equal(decrypt(cipher), "test-not-a-real-key");
  assert.ok(!cipher.includes("test-not-a-real-key"));
  const raw = Buffer.from(cipher, "base64");
  raw[15] ^= 1;
  assert.throws(() => decrypt(raw.toString("base64")));
});
test("阻止私网、回环、元数据和未允许的模型地址", () => {
  for (const addr of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])
    assert.equal(publicAddress(addr), false, addr);
  assert.equal(publicAddress("1.1.1.1"), true);
  assert.throws(() => providerURL("https://attacker.example/v1"));
  assert.throws(() => providerURL("http://api.openai.com/v1"));
});

test("连续进程中断超过恢复上限后停止自动调用", () => {
  const { db, uid } = fixture();
  submit(db, uid, { text: "crash-loop" }, "crash");
  for (let i = 0; i < 3; i++) {
    assert.ok(claim(db));
    db.prepare("UPDATE tasks SET lease_until=0").run();
  }
  assert.equal(claim(db), null);
  assert.equal(db.prepare("SELECT stage FROM tasks").get().stage, "failed");
  db.close();
});
