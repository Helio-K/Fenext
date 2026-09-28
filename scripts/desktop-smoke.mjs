import { _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const profile = await fs.mkdtemp(
  path.join(os.tmpdir(), "fenext-desktop-test-"),
);
const backend = spawn(process.execPath, ["scripts/ui-test-server.mjs"], {
  stdio: "ignore",
});
let app;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const r = await fetch("http://127.0.0.1:4311/api/health");
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  app = await electron.launch({
    ...(process.env.FENEXT_SMOKE_EXECUTABLE
      ? { executablePath: process.env.FENEXT_SMOKE_EXECUTABLE }
      : { args: ["."] }),
    env: {
      ...process.env,
      FENEXT_APP_URL: "http://127.0.0.1:4311",
      FENEXT_USER_DATA: profile,
    },
  });
  const window = await app.firstWindow();
  const initial = await app.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0].getBounds();
    return { bounds, area: screen.getDisplayMatching(bounds).workArea };
  });
  assert.ok(
    initial.bounds.x >= initial.area.x && initial.bounds.y >= initial.area.y,
  );
  assert.ok(
    initial.bounds.x + initial.bounds.width <=
      initial.area.x + initial.area.width &&
      initial.bounds.y + initial.bounds.height <=
        initial.area.y + initial.area.height,
  );
  await window.getByLabel("账号", { exact: true }).fill("ui-test");
  await window.getByLabel("密码", { exact: true }).fill("fenext-e2e-password");
  await window
    .getByRole("button", { name: "进入知识空间", exact: true })
    .click();
  await window.getByRole("heading", { name: "收集箱", exact: true }).waitFor();
  const state = await window.evaluate(() => window.fenext.status());
  assert.ok(state.deviceId);
  assert.equal(
    await window.evaluate(() => typeof window.fenext.connectObsidian),
    "function",
  );
  await window.getByRole("button", { name: "个人菜单", exact: true }).click();
  await window.getByRole("link", { name: "设置与同步", exact: true }).click();
  await window.getByRole("button", { name: "Obsidian 同步", exact: true }).click();
  await window.getByRole("button", { name: "连接 Obsidian", exact: true }).waitFor();
  const vault = path.join(profile, "测试 Obsidian 库");
  await fs.mkdir(path.join(vault, ".obsidian"), { recursive: true });
  await fs.mkdir(path.join(profile, "obsidian"));
  await fs.writeFile(
    path.join(profile, "obsidian", "obsidian.json"),
    JSON.stringify({ vaults: { test: { path: vault, open: true } } }),
  );
  await app.evaluate(({ app, dialog }, data) => {
    app.setPath("appData", data.profile);
    dialog.showMessageBox = async () => ({ response: 0 });
  }, { profile });
  await window.getByRole("button", { name: "连接 Obsidian", exact: true }).click();
  await window.getByRole("button", { name: "更换 Obsidian 知识库", exact: true }).waitFor();
  const connected = await window.evaluate(() => window.fenext.status());
  assert.equal(connected.directory, path.join(await fs.realpath(vault), "Fenext"));
  assert.equal(connected.vaultName, "测试 Obsidian 库");
  const imported = await window.evaluate(async () => {
    const response = await fetch("/api/notes/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Obsidian 连接测试",
        body: "设置完成后可在 Obsidian 查看。",
        sourceKey: "desktop-smoke-obsidian",
      }),
    });
    return { status: response.status, note: await response.json() };
  });
  assert.equal(imported.status, 201);
  const synced = await window.evaluate(() => window.fenext.sync());
  assert.ok(synced.paths?.[imported.note.id]);
  assert.match(
    await fs.readFile(path.join(connected.directory, synced.paths[imported.note.id]), "utf8"),
    /设置完成后可在 Obsidian 查看/,
  );
  await window.goto("http://127.0.0.1:4311/knowledge");
  await window.getByRole("button", { name: "立即同步到 Obsidian" }).click();
  await window.getByRole("dialog", { name: "同步完成" }).waitFor();
  await window.getByRole("button", { name: "稍后" }).click();
  await window.goto("http://127.0.0.1:4311/notes/" + imported.note.id);
  await window.getByRole("button", { name: "立即同步到 Obsidian" }).click();
  const prompt = window.getByRole("dialog", { name: "同步完成" });
  await prompt.getByText("是否现在打开这篇笔记？", { exact: false }).waitFor();
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      globalThis.fenextSmokeOpenUrl = url;
    };
  });
  await prompt.getByRole("button", { name: "现在打开 Obsidian" }).click();
  assert.equal(
    await app.evaluate(() => globalThis.fenextSmokeOpenUrl),
    "obsidian://open?path=" +
      encodeURIComponent(path.join(connected.directory, synced.paths[imported.note.id])),
  );
  await window.goto("http://127.0.0.1:4311/settings?tab=sync");
  await fs.mkdir(".local/qa", { recursive: true });
  await window.screenshot({ path: ".local/qa/desktop-obsidian.png" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(900, 600),
  );
  await window.getByRole("button", { name: "个人菜单", exact: true }).waitFor();
  assert.ok(
    await window
      .getByRole("button", { name: "个人菜单", exact: true })
      .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
  );
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    await new Promise((resolve) => {
      w.once("enter-full-screen", () => resolve(true));
      w.setFullScreen(true);
    });
  });
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen(),
    ),
    true,
  );
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    await new Promise((resolve) => {
      w.once("leave-full-screen", () => resolve(true));
      w.setFullScreen(false);
    });
  });
  assert.ok(
    await window
      .getByRole("button", { name: "个人菜单", exact: true })
      .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
  );
  const registered = await app.evaluate(({ globalShortcut }) =>
    globalShortcut.isRegistered(
      process.platform === "darwin" ? "Alt+Command+F" : "Control+Alt+F",
    ),
  );
  assert.equal(registered, true);
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items[0].submenu.items.find((item) => item.label === "快捷收集")
      .click(),
  );
  let quick;
  for (let n = 0; n < 30; n++) {
    quick = app.windows().find((w) => w !== window);
    if (quick) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(quick);
  await quick.getByRole("heading", { name: "快捷收集", exact: true }).waitFor();
  await quick.getByLabel("文字内容", { exact: true }).fill("桌面浮窗草稿测试");
  await quick.keyboard.press("Escape");
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items[0].submenu.items.find((item) => item.label === "快捷收集")
      .click(),
  );
  assert.equal(
    await quick.getByLabel("文字内容", { exact: true }).inputValue(),
    "桌面浮窗草稿测试",
  );
  await fs.mkdir(".local/qa", { recursive: true });
  await quick.screenshot({ path: ".local/qa/desktop-quick.png" });
  console.log(
    "Electron smoke passed: work-area bounds, window resize, macOS fullscreen roundtrip, login, Obsidian vault connection and note export, isolated bridge, registered global shortcut, quick window, Esc draft preservation.",
  );
} finally {
  if (app) await app.close();
  backend.kill("SIGTERM");
  await fs.rm(profile, { recursive: true, force: true });
}
