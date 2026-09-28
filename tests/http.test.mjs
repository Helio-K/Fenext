import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server/index.mjs";
import { openDB, id, now } from "../server/db.mjs";
import { passwordHash } from "../server/security.mjs";
import { insertNote } from "./helpers.mjs";

test("HTTP authentication, account boundaries, token scopes, persisted retry and settings privacy", async (t) => {
  const db = openDB(":memory:"),
    server = createServer(db);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    db.close();
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  async function request(p, body, token, extra = {}) {
    const r = await fetch(origin + "/api" + p, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
  }
  const anonymous = await request("/notes");
  assert.equal(anonymous.status, 401);
  const setup = await request("/setup", {
    username: "http-user",
    password: "long-test-password",
    client: "mini",
  });
  assert.equal(setup.status, 200);
  assert.ok(setup.headers.get("set-cookie").includes("HttpOnly"));
  const token = setup.body.token;
  const second = await request("/setup", {
    username: "another",
    password: "long-test-password",
  });
  assert.equal(second.status, 409);
  const t1 = await request("/tasks", { text: "persistent source" }, token, {
    "Idempotency-Key": "request-one",
  });
  assert.equal(t1.status, 201);
  assert.equal(t1.body.stage, "waiting_config");
  const t2 = await request("/tasks", { text: "persistent source" }, token, {
    "Idempotency-Key": "request-two",
  });
  assert.equal(t2.body.id, t1.body.id);
  assert.equal(
    (
      await request("/tasks", { text: "bad-origin" }, token, {
        Origin: "https://evil.example",
        "Idempotency-Key": "evil",
      })
    ).status,
    403,
  );
  const scoped = await request(
    "/integrations/tokens",
    { label: "fixture" },
    token,
  );
  assert.equal(
    (await request("/notes", undefined, scoped.body.token)).status,
    403,
  );
  assert.equal(
    (await request("/tasks/" + t1.body.id, undefined, scoped.body.token))
      .status,
    200,
  );
  const otherId = id();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    otherId,
    "other-user",
    await passwordHash("another-test-password"),
    now(),
  );
  const foreign = insertNote(db, otherId);
  assert.equal(
    (await request("/notes/" + foreign.id, undefined, token)).status,
    404,
  );
  assert.equal(
    (
      await request("/tasks", { text: "mine", userId: otherId }, token, {
        "Idempotency-Key": "own",
      })
    ).body.user_id,
    setup.body.user.id,
  );
  const meNote = insertNote(db, setup.body.user.id);
  const chat = await request(
    "/notes/" + meNote.id + "/chat",
    { text: "解释一下", mode: "discuss" },
    token,
  );
  assert.equal(chat.status, 500);
  const messages = await request(
    "/notes/" + meNote.id + "/chat",
    undefined,
    token,
  );
  assert.equal(messages.body.length, 2);
  assert.equal(messages.body[1].kind, "error");
  const settings = await request("/settings", undefined, token);
  assert.equal(settings.body.ai, null);
  assert.equal(settings.body.capabilities.wechat, false);
  await request("/logout", {}, token);
  assert.equal((await request("/me", undefined, token)).status, 401);
});
