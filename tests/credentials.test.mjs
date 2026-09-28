import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDB, now, id } from "../server/db.mjs";
import { fixture } from "./helpers.mjs";
import { hash } from "../server/security.mjs";
import { createServer } from "../server/index.mjs";

test("legacy credentials migrate without reviving expired sessions; timestamps survive reopening", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fenext-credentials-"));
  let db;
  try {
    const file = path.join(dir, "test.sqlite");
    db = openDB(file);
    const uid = id();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      uid,
      "legacy",
      "unused",
      now(),
    );
    db.exec(
      "DROP TABLE sessions; CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL); DELETE FROM migrations WHERE version=3;",
    );
    const issued = now();
    const expiry = new Date(Date.parse(issued) + 30 * 86400000).toISOString();
    const insert = db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)");
    insert.run("active", uid, expiry, "ingestion", "Chrome");
    insert.run("expired", uid, "2020-02-01T00:00:00.000Z", "ingestion", "old");
    insert.run("login", uid, expiry, "session", "");
    db.close();
    db = openDB(file);
    const active = db
      .prepare("SELECT * FROM sessions WHERE token_hash='active'")
      .get();
    assert.equal(active.expires_at, null);
    assert.equal(active.created_at, issued);
    assert.equal(
      db
        .prepare("SELECT expires_at FROM sessions WHERE token_hash='expired'")
        .get().expires_at,
      "2020-02-01T00:00:00.000Z",
    );
    assert.equal(
      db
        .prepare("SELECT expires_at FROM sessions WHERE token_hash='login'")
        .get().expires_at,
      expiry,
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    db.close();
    db = openDB(file);
    assert.deepEqual(
      db.prepare("SELECT * FROM sessions WHERE token_hash='active'").get(),
      active,
    );
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("credentials support remarks, permanent authentication, creation dates and immediate owner-only deletion", async (t) => {
  const { db, uid } = fixture();
  const other = id();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    other,
    "other",
    "unused",
    now(),
  );
  for (const [raw, user] of [
    ["owner", uid],
    ["other", other],
  ])
    db.prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,kind,label) VALUES(?,?,?,?,?)",
    ).run(
      hash(raw),
      user,
      new Date(Date.now() + 86400000).toISOString(),
      "session",
      "",
    );
  const server = createServer(db);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    db.close();
  });
  const request = async (
    route,
    method = "GET",
    body,
    token = "owner",
    headers = {},
  ) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api${route}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { status: r.status, data: await r.json() };
  };
  const made = await request("/integrations/tokens", "POST", {
    label: "  Chrome · 工作电脑  ",
  });
  assert.equal(made.status, 200);
  const credential = made.data;
  assert.equal(credential.label, "Chrome · 工作电脑");
  assert.equal(credential.expires_at, null);
  assert.ok(Math.abs(Date.parse(credential.created_at) - Date.now()) < 5000);
  const list = await request("/integrations/tokens");
  assert.equal(list.data[0].created_at, credential.created_at);
  assert.equal(JSON.stringify(list.data).includes(credential.token), false);
  const origin = { Origin: `chrome-extension://${"a".repeat(32)}` };
  assert.equal(
    (
      await request(
        "/integrations/connection?browser=chrome",
        "GET",
        undefined,
        credential.token,
        origin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/integrations/extension/status")).data.state,
    "connected",
  );
  // Permanence does not depend on a long synthetic expiry or the creation date.
  db.prepare(
    "UPDATE sessions SET created_at='2000-01-01T00:00:00Z' WHERE token_hash=?",
  ).run(credential.id);
  assert.equal(
    (
      await request(
        "/integrations/connection",
        "GET",
        undefined,
        credential.token,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/integrations/tokens/${credential.id}`, "PATCH", {
        label: "Edge · 家用电脑",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/integrations/tokens/${credential.id}`,
        "PATCH",
        { label: "x" },
        "other",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/integrations/tokens/${credential.id}`,
        "DELETE",
        {},
        "other",
      )
    ).status,
    404,
  );
  assert.equal(
    (await request("/integrations/tokens", "GET", undefined, credential.token))
      .status,
    403,
  );
  assert.equal(
    (await request(`/integrations/tokens/${credential.id}`, "DELETE", {}))
      .status,
    200,
  );
  assert.equal(
    (
      await request(
        "/integrations/connection",
        "GET",
        undefined,
        credential.token,
      )
    ).status,
    401,
  );
  assert.equal(
    (await request("/integrations/extension/status")).data.state,
    "expired",
  );
  assert.equal((await request("/integrations/tokens")).data.length, 0);
});
