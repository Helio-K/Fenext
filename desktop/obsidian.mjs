import fs from "node:fs/promises";
import path from "node:path";

export async function registeredVaults(appData) {
  let config;
  try {
    config = JSON.parse(
      await fs.readFile(path.join(appData, "obsidian", "obsidian.json"), "utf8"),
    );
  } catch {
    return [];
  }
  const vaults = [];
  for (const entry of Object.values(config.vaults || {})) {
    if (typeof entry?.path !== "string") continue;
    try {
      const root = await fs.realpath(entry.path);
      if (!(await fs.stat(path.join(root, ".obsidian"))).isDirectory())
        continue;
      if (!vaults.some((vault) => vault.path === root))
        vaults.push({ path: root, name: path.basename(root), open: entry.open === true });
    } catch {
      // Obsidian may retain entries for moved or deleted vaults.
    }
  }
  return vaults.sort((a, b) => Number(b.open) - Number(a.open));
}

export async function prepareVaultDirectory(vaultPath) {
  const root = await fs.realpath(vaultPath);
  const marker = await fs.stat(path.join(root, ".obsidian")).catch(() => null);
  if (!marker?.isDirectory())
    throw new Error("请选择 Obsidian 知识库文件夹（包含 .obsidian）");
  const directory = path.join(root, "Fenext");
  try {
    const existing = await fs.lstat(directory);
    if (!existing.isDirectory() || existing.isSymbolicLink())
      throw new Error("知识库中的 Fenext 路径不是普通文件夹，请选择其他知识库");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(directory);
  }
  return { vaultPath: root, directory };
}
