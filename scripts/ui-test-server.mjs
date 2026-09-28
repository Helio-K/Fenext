import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
process.env.APP_ORIGIN = "http://127.0.0.1:4311";
const { openDB, id, now } = await import("../server/db.mjs");
const { passwordHash } = await import("../server/security.mjs");
const { createServer } = await import("../server/index.mjs");
const { suggestion, submit } = await import("../server/domain.mjs");
const { repairBlockedCompletions } =
  await import("../server/source-access.mjs");
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fenext-ui-"));
const db = openDB(path.join(dir, "test.sqlite"));
const uid = id();
db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
  uid,
  "ui-test",
  await passwordHash("fenext-e2e-password"),
  now(),
);
const body =
  "## 是什么\n根据当前信息决定行动，观察结果，再调整下一步。\n\n## 为什么 AI PM 值得学\n理解任务如何在工具反馈中继续推进。\n\n## 什么时候考虑\n任务的下一步取决于刚拿到的信息。\n\n## 如何比较和组合\n[[工具调用]] 负责执行动作；[[RAG]] 可提供检索材料。\n\n## 边界与失败表现\n行动循环本身不保证任务完成。\n\n## 案例与来源\n此内容为界面自动化测试夹具，不是实际资料提炼。\n";
for (const [nid, title, text] of [
  ["ui-react", "ReAct", body],
  [
    "ui-tools",
    "工具调用",
    "## 是什么\n模型通过结构化请求调用外部能力。\n\n## 适用条件\n需要外部系统实际执行动作时。",
  ],
]) {
  db.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    nid,
    uid,
    title,
    "[]",
    "基础必学",
    "用于理解 Agent 在产品方案中的职责与边界。",
    '["任务的下一步取决于刚拿到的信息，应该怎么设计？"]',
    text,
    1,
    now(),
    now(),
  );
  db.prepare("INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)").run(
    id(),
    nid,
    uid,
    1,
    text,
    "自动化测试夹具",
    "fixture",
    now(),
  );
}
const t = submit(
  db,
  uid,
  {
    text: "Agent 的行动循环与工具反馈（自动化测试资料）",
    title: "Agent 的行动循环与工具反馈",
    app: "界面测试夹具",
  },
  "ui-fixture",
);
const note = db.prepare("SELECT * FROM notes WHERE id='ui-react'").get();
const sid = suggestion(
  db,
  note,
  body.replace(
    "行动循环本身不保证任务完成。",
    "行动循环仍需额外的停止、验证和状态机制。",
  ),
  "补充适用边界，避免把行动循环当成完整执行保障。",
  t.id,
);
db.prepare("UPDATE tasks SET stage='completed',result=? WHERE id=?").run(
  JSON.stringify({
    new: [],
    existing: [
      { id: "ui-react", title: "ReAct" },
      { id: "ui-tools", title: "工具调用" },
    ],
    updates: [{ id: sid, noteId: "ui-react", title: "ReAct" }],
    uncertain: [],
    summary: "自动化测试夹具：知识已有，新增的边界说明等待审核。",
  }),
  t.id,
);
const blockedTask = submit(
  db,
  uid,
  {
    url: "https://mp.weixin.qq.com/s/test-unread",
    title: "未读到正文的公众号资料",
  },
  "historical-blocked",
);
db.prepare(
  "UPDATE tasks SET stage='completed',checkpoint=?,result=? WHERE id=?",
).run(
  JSON.stringify({
    read: [
      {
        kind: "web",
        url: "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha",
        content: "环境异常 当前环境异常，完成验证后即可继续访问。",
      },
    ],
    analysis: { summary: "误把验证页视为完成", items: [] },
  }),
  JSON.stringify({
    new: [],
    existing: [],
    updates: [],
    uncertain: [],
    summary: "误把验证页视为完成",
  }),
  blockedTask.id,
);
repairBlockedCompletions(db);
const server = createServer(db, { authRateMax: 1000 });
server.listen(4311, "127.0.0.1");
async function stop() {
  server.closeAllConnections();
  server.close();
  db.close();
  await fs.rm(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
