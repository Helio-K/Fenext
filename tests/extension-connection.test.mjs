import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server/index.mjs";
import { fixture } from "./helpers.mjs";
import { id, now } from "../server/db.mjs";
import { hash } from "../server/security.mjs";
import { submit } from "../server/domain.mjs";

test("来源状态仅由真实验证或插件提交确认，按账户隔离，并随凭证失效更新", async (t) => {
  const { db, uid } = fixture();
  const other = id();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    other,
    "other-connection-user",
    "unused",
    now(),
  );
  const expiry = new Date(Date.now() + 86400000).toISOString();
  function credential(raw, userId, kind) {
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,kind,label) VALUES(?,?,?,?,?)").run(
      hash(raw),
      userId,
      expiry,
      kind,
      "fixture",
    );
  }
  credential("web-token", uid, "session");
  credential("other-web", other, "session");
  credential("chrome-token", uid, "ingestion");
  credential("edge-token", uid, "ingestion");
  credential("other-plugin", other, "ingestion");
  const server = createServer(db);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const origin = "chrome-extension://" + "c".repeat(32);
  async function get(p, token, headers = {}) {
    const response = await fetch(base + p, {
      headers: { Authorization: `Bearer ${token}`, ...headers },
    });
    return { status: response.status, data: await response.json() };
  }
  const status = (token = "web-token") =>
    get("/integrations/extension/status", token);
  assert.equal((await status()).data.state, "disconnected"); // Creating a credential is not a connection.
  assert.equal(
    (await get("/integrations/connection", "chrome-token")).status,
    200,
  );
  assert.equal((await status()).data.state, "disconnected"); // A CLI credential check is not a browser connection.
  assert.equal(
    (
      await get(
        "/integrations/connection?browser=chrome&version=0.1.5",
        "chrome-token",
        { Origin: origin },
      )
    ).status,
    200,
  );
  let state = (await status()).data;
  assert.equal(state.state, "connected");
  assert.equal(state.connections[0].browser, "chrome");
  assert.equal(state.connections[0].version, "0.1.5");
  assert.equal(state.connections[0].active, true);
  assert.equal(JSON.stringify(state).includes(hash("chrome-token")), false);
  await get(
    "/integrations/connection?browser=chrome&version=0.1.5",
    "chrome-token",
    { Origin: origin },
  );
  assert.equal((await status()).data.connections.length, 1);
  await get("/integrations/connection", "edge-token", {
    Origin: origin,
    "User-Agent": "Mozilla/5.0 Chrome/140.0 Edg/140.0",
  });
  assert.deepEqual(
    (await status()).data.connections.map((c) => c.browser).sort(),
    ["chrome", "edge"],
  );
  assert.equal((await status("other-web")).data.state, "disconnected");
  assert.equal((await status("chrome-token")).status, 403);
  db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
    hash("chrome-token"),
  );
  assert.equal((await status()).data.state, "connected"); // Edge is still connected.
  db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(
    "2000-01-01T00:00:00Z",
    hash("edge-token"),
  );
  assert.equal((await status()).data.state, "expired");
  assert.equal(
    (await get("/integrations/connection", "edge-token", { Origin: origin }))
      .status,
    401,
  );
  submit(
    db,
    other,
    { text: "来自旧版插件的历史资料", app: "Fenext 浏览器插件" },
    "legacy-extension",
  );
  assert.equal((await status("other-web")).data.state, "unverified");
  const submitted = await fetch(base + "/tasks", {
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: "Bearer other-plugin",
      "Content-Type": "application/json",
      "Idempotency-Key": "old-popup-submit",
    },
    body: JSON.stringify({
      text: "通过已连接的旧版插件提交真实文章正文",
      app: "Fenext插件",
    }),
  });
  assert.equal(submitted.status, 201);
  assert.equal((await status("other-web")).data.state, "connected");
});
