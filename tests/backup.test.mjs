import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openDB, id, now } from "../server/db.mjs";
test("一致性备份可重新打开，包含匹配的解密密钥", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fenext-backup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data"),
    target = path.join(root, "snapshot");
  const db = openDB(path.join(data, "fenext.sqlite"));
  const uid = id();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    uid,
    "backup-fixture",
    "test",
    now(),
  );
  await promisify(execFile)(process.execPath, ["scripts/backup.mjs", target], {
    env: { ...process.env, DATA_DIR: data, MASTER_KEY: "b".repeat(64) },
  });
  db.close();
  const restored = openDB(path.join(target, "fenext.sqlite"));
  assert.equal(restored.prepare("SELECT id FROM users").get().id, uid);
  restored.close();
  assert.equal(
    (await fs.readFile(path.join(target, "master.key"))).toString("hex"),
    "b".repeat(64),
  );
  assert.equal(
    (await fs.stat(path.join(target, "master.key"))).mode & 0o777,
    0o600,
  );
});
