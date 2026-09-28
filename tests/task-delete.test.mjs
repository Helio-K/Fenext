import test from "node:test";
import assert from "node:assert/strict";
import { fixture, item } from "./helpers.mjs";
import { createServer } from "../server/index.mjs";
import { hash } from "../server/security.mjs";
import { submit } from "../server/domain.mjs";
import { claim, runTask } from "../server/worker.mjs";

test("删除跨端一致，凭证范围隔离；迟到模型不能写入，重新收集可新建，知识与来源保留", async () => {
  const { db, uid } = fixture();
  const server = createServer(db);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  for (const kind of ["session", "ingestion"])
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,kind,label) VALUES(?,?,?,?,?)").run(
      hash(kind),
      uid,
      new Date(Date.now() + 86400000).toISOString(),
      kind,
      "fixture",
    );
  const request = (route, method = "GET", token = "session") =>
    fetch(base + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    });
  try {
    const task = submit(db, uid, { text: "delete while running" }, "one");
    const active = claim(db);
    await runTask(db, active, {
      reader: async () => [{ kind: "text", content: "正文" }],
      analyzer: async () => {
        assert.equal(
          (await request("/tasks/" + task.id, "DELETE", "ingestion")).status,
          403,
        );
        assert.equal(
          (await request("/tasks/" + task.id, "DELETE")).status,
          200,
        );
        return { summary: "迟到回复", items: [item("不应保存")] };
      },
    });
    assert.equal((await request("/tasks/" + task.id)).status, 404);
    assert.equal(
      (await request("/tasks/" + task.id + "/retry", "POST")).status,
      404,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM notes").get().n, 0);
    assert.deepEqual(await (await request("/tasks")).json(), []);
    const next = submit(db, uid, { text: "delete while running" }, "two");
    assert.notEqual(next.id, task.id);
    await runTask(db, claim(db), {
      reader: async () => [{ kind: "text", content: "正文" }],
      analyzer: async () => ({ summary: "完成", items: [item("保留笔记")] }),
    });
    assert.equal((await request("/tasks/" + next.id, "DELETE")).status, 200);
    assert.equal(db.prepare("SELECT count(*) AS n FROM notes").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sources").get().n, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
  }
});
