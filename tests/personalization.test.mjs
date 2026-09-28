import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";
import { createServer } from "../server/index.mjs";
import { hash } from "../server/security.mjs";
import { submit } from "../server/domain.mjs";
import { id, now } from "../server/db.mjs";

test("profile and material preferences persist, share within a group, and remain account scoped", async (t) => {
  const { db, uid } = fixture();
  const other = id();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    other,
    "other-user",
    "unused",
    now(),
  );
  for (const [token, user, kind] of [
    ["owner", uid, "session"],
    ["other", other, "session"],
    ["plugin", uid, "ingestion"],
  ])
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,kind,label) VALUES(?,?,?,?,?)").run(
      hash(token),
      user,
      new Date(Date.now() + 86400000).toISOString(),
      kind,
      "test",
    );
  const server = createServer(db);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    db.close();
  });
  const request = async (path, body, token = "owner") => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method: body === undefined ? "GET" : "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { status: r.status, data: await r.json() };
  };
  const updated = await request("/me", { displayName: "April", avatar: "🦊" });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.username, "test-user");
  assert.equal((await request("/me")).data.avatar, "🦊");
  assert.equal(
    (await request("/me", undefined, "other")).data.displayName,
    undefined,
  );
  assert.equal(
    (await request("/me", { displayName: "", avatar: "🦊" })).status,
    400,
  );
  assert.equal(
    (await request("/me", { displayName: "April", avatar: "arbitrary" }))
      .status,
    400,
  );
  assert.equal(
    (await request("/me", { displayName: "plugin", avatar: "" }, "plugin"))
      .status,
    403,
  );
  const a = submit(db, uid, { text: "相同正文", question: "问题一" }, "one");
  const b = submit(db, uid, { text: "相同正文", question: "问题二" }, "two");
  const c = submit(db, other, { text: "相同正文" }, "three");
  assert.equal(
    (await request(`/tasks/${a.id}/icon`, { emoji: "🧠" })).status,
    200,
  );
  assert.equal((await request(`/tasks/${b.id}`)).data.icon, "🧠");
  assert.equal(
    (await request(`/tasks/${c.id}`, undefined, "other")).data.icon,
    "",
  );
  assert.equal(
    (await request(`/tasks/${a.id}/icon`, { emoji: "💡" }, "other")).status,
    404,
  );
  assert.equal(
    (await request(`/tasks/${a.id}/icon`, { emoji: "💡" }, "plugin")).status,
    403,
  );
  assert.equal(
    (await request(`/tasks/${a.id}/icon`, { emoji: "invalid" })).status,
    400,
  );
  assert.equal(
    (await request(`/tasks/${a.id}/icon`, { emoji: "" })).status,
    200,
  );
  assert.equal((await request(`/tasks/${b.id}`)).data.icon, "");
});
