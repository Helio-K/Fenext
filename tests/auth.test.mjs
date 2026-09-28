import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server/index.mjs";
import { openDB } from "../server/db.mjs";

test("统一账号入口注册、登录、并发创建、密码校验和初始化权限", async (t) => {
  const db = openDB(":memory:"),
    server = createServer(db);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function enter(username, password = "long-test-password", extra = {}) {
    const r = await fetch(base + "/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, client: "mini", ...extra }),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie"),
    };
  }
  const first = await enter("  first-user  ");
  assert.equal(first.status, 200);
  assert.equal(first.body.created, true);
  assert.equal(first.body.user.username, "first-user");
  assert.ok(first.cookie.includes("HttpOnly"));
  assert.notEqual(
    db.prepare("SELECT password FROM users").get().password,
    "long-test-password",
  );
  const me = await fetch(base + "/me", {
    headers: { Authorization: `Bearer ${first.body.token}` },
  });
  assert.deepEqual(await me.json(), first.body.user);
  const login = await enter("first-user");
  assert.equal(login.body.created, false);
  assert.equal(login.body.user.id, first.body.user.id);
  const before = db.prepare("SELECT count(*) AS n FROM sessions").get().n;
  assert.equal((await enter("first-user", "incorrect-password")).status, 401);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sessions").get().n,
    before,
  );
  const second = await enter("second-user");
  assert.equal(second.body.created, true);
  assert.notEqual(second.body.user.id, first.body.user.id);
  const concurrent = await Promise.all([
    enter("same-user"),
    enter("same-user"),
  ]);
  assert.ok(concurrent.every((r) => r.status === 200));
  assert.equal(concurrent.filter((r) => r.body.created).length, 1);
  assert.equal(concurrent[0].body.user.id, concurrent[1].body.user.id);
  const competing = await Promise.all([
    enter("competing-user", "password-one-long"),
    enter("competing-user", "password-two-long"),
  ]);
  assert.deepEqual(competing.map((r) => r.status).sort(), [200, 401]);
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM users WHERE username=?")
      .get("competing-user").n,
    1,
  );
  assert.equal((await enter("x")).status, 400);
  assert.equal((await enter("short-password-user", "short")).status, 400);

  // First-account initialization protection also applies to the unified endpoint.
  const protectedDB = openDB(":memory:"),
    protectedServer = createServer(protectedDB);
  await new Promise((resolve) =>
    protectedServer.listen(0, "127.0.0.1", resolve),
  );
  const saved = process.env.SETUP_TOKEN;
  process.env.SETUP_TOKEN = "test-admin-initialization-token";
  t.after(() => {
    if (saved === undefined) delete process.env.SETUP_TOKEN;
    else process.env.SETUP_TOKEN = saved;
    protectedServer.closeAllConnections();
    protectedServer.close();
    protectedDB.close();
  });
  const protectedBase = `http://127.0.0.1:${protectedServer.address().port}/api`;
  assert.equal(
    (await (await fetch(protectedBase + "/bootstrap")).json()).needsSetupToken,
    true,
  );
  async function initialize(setupToken) {
    return fetch(protectedBase + "/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "protected-user",
        password: "long-test-password",
        setupToken,
      }),
    });
  }
  assert.equal((await initialize("wrong-token")).status, 403);
  assert.equal(
    protectedDB.prepare("SELECT count(*) AS n FROM users").get().n,
    0,
  );
  assert.equal((await initialize(process.env.SETUP_TOKEN)).status, 200);
  assert.equal(
    (await (await fetch(protectedBase + "/bootstrap")).json()).needsSetupToken,
    false,
  );
  assert.equal((await enter("rate-limited-user")).status, 429);
});
