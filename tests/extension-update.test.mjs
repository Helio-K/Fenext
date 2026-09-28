import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { packageExtension } from "../scripts/package-extension.mjs";
import { extensionRelease } from "../server/extension-release.mjs";
import { createServer } from "../server/index.mjs";
import { openDB } from "../server/db.mjs";

const context = vm.createContext({});
vm.runInContext(await fs.readFile("extension/update.js", "utf8"), context);
const { isNewerVersion } = context.FenextUpdate;
test("插件版本按数字比较，不误报旧版、同版或无效版本", () => {
  assert.equal(isNewerVersion("0.1.10", "0.1.9"), true);
  assert.equal(isNewerVersion("1.0", "0.99.99"), true);
  assert.equal(isNewerVersion("0.1.4.1", "0.1.4"), true);
  assert.equal(isNewerVersion("0.1.4.0", "0.1.4"), false);
  assert.equal(isNewerVersion("0.1.3", "0.1.4"), false);
  for (const bad of ["", "01.2", "0.1.4-beta", "1.2.3.4.5", "65536.0", null])
    assert.equal(isNewerVersion(bad, "0.1.4"), false);
});
test("发布包和版本匹配，匿名下载无需凭证，跨浏览器更新查询可用，损坏包不发布", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "fenext-extension-release-"),
  );
  const output = path.join(directory, "release");
  const release = await packageExtension(path.resolve("extension"), output);
  const db = openDB(":memory:"),
    server = createServer(db, { extensionDirectory: output });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = "chrome-extension://" + "b".repeat(32);
  const latest = await fetch(base + "/api/integrations/extension/latest", {
    headers: { Origin: origin },
  });
  assert.equal(latest.status, 200);
  assert.equal(latest.headers.get("access-control-allow-origin"), origin);
  const info = await latest.json();
  assert.equal(info.version, release.version);
  assert.deepEqual(info.changes, release.changes);
  assert.equal(info.downloadUrl.includes("token"), false);
  const downloaded = await fetch(base + info.downloadUrl);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), "application/zip");
  assert.match(
    downloaded.headers.get("content-disposition"),
    new RegExp(release.fileName.replaceAll(".", "\\.")),
  );
  assert.deepEqual(
    Buffer.from(await downloaded.arrayBuffer()),
    await fs.readFile(path.join(output, release.fileName)),
  );
  assert.equal(
    (
      await fetch(
        base + "/api/integrations/extension/download?version=old-version",
      )
    ).status,
    409,
  );
  await fs.writeFile(path.join(output, release.fileName), "damaged archive");
  assert.throws(() => extensionRelease(output), { status: 503 });
  assert.equal(
    (await fetch(base + "/api/integrations/extension/latest")).status,
    503,
  );
  assert.equal((await fetch(base + info.downloadUrl)).status, 503);
});
