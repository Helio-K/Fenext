import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registeredVaults, prepareVaultDirectory } from "../desktop/obsidian.mjs";
import { syncDirectory } from "../desktop/sync.mjs";

test("连接 Obsidian 后，Fenext 笔记出现在该知识库的专用目录", async (t) => {
  const appData = await fs.mkdtemp(path.join(os.tmpdir(), "fenext-obsidian-"));
  t.after(() => fs.rm(appData, { recursive: true, force: true }));
  const vault = path.join(appData, "我的知识库");
  await fs.mkdir(path.join(vault, ".obsidian"), { recursive: true });
  await fs.mkdir(path.join(appData, "obsidian"));
  await fs.writeFile(
    path.join(appData, "obsidian", "obsidian.json"),
    JSON.stringify({ vaults: { one: { path: vault, open: true } } }),
  );
  const discovered = await registeredVaults(appData);
  const realVault = await fs.realpath(vault);
  assert.deepEqual(discovered, [{ path: realVault, name: "我的知识库", open: true }]);
  const selected = await prepareVaultDirectory(discovered[0].path);
  assert.equal(selected.directory, path.join(realVault, "Fenext"));
  const note = {
    id: "note-test",
    title: "测试笔记",
    aliases: [],
    level: "场景相关",
    version: 1,
    body: "从 Fenext 同步来的内容。",
    updated_at: "2026-09-28T00:00:00.000Z",
  };
  const result = await syncDirectory(selected.directory, async (route) => {
    if (route === "/me") return { id: "test-user" };
    if (route === "/notes") return [note];
    throw new Error(`unexpected ${route}`);
  });
  assert.match(
    await fs.readFile(path.join(selected.directory, result.paths[note.id]), "utf8"),
    /从 Fenext 同步来的内容/,
  );
});

test("只接受真正的 Obsidian 知识库，不覆盖同名文件或跟随符号链接", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fenext-vault-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => prepareVaultDirectory(root), /Obsidian 知识库/);
  await fs.mkdir(path.join(root, ".obsidian"));
  await fs.writeFile(path.join(root, "Fenext"), "原文件");
  await assert.rejects(() => prepareVaultDirectory(root), /不是普通文件夹/);
  assert.equal(await fs.readFile(path.join(root, "Fenext"), "utf8"), "原文件");
});
