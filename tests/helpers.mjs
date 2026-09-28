import { openDB, id, now } from "../server/db.mjs";
export function fixture() {
  const db = openDB(":memory:"),
    uid = id();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    uid,
    "test-user",
    "unused",
    now(),
  );
  db.prepare("INSERT INTO settings VALUES(?,?,?,?,1)").run(
    uid,
    "https://api.openai.com/v1",
    "test-model",
    "test-cipher",
  );
  return { db, uid };
}
export function insertNote(
  db,
  uid,
  title = "ReAct",
  body = "## 是什么\n行动与观察。\n\n## 边界与失败表现\n仍需额外停止机制。\n",
) {
  const nid = id(),
    time = now();
  db.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    nid,
    uid,
    title,
    "[]",
    "基础必学",
    "帮助产品判断",
    "[]",
    body,
    1,
    time,
    time,
  );
  db.prepare("INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)").run(
    id(),
    nid,
    uid,
    1,
    body,
    "测试夹具",
    "fixture",
    time,
  );
  return db.prepare("SELECT * FROM notes WHERE id=?").get(nid);
}
export const item = (
  title,
  kind = "new",
  noteId = null,
  body = "## 是什么\n测试知识正文。\n",
) => ({
  kind,
  noteId,
  title,
  aliases: [],
  level: "基础必学",
  reason: "来自测试材料",
  questions: ["如何设计行动循环？"],
  body,
  evidence: "测试夹具依据",
});
