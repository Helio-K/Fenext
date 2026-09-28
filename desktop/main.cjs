const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  shell,
  session,
  net,
  screen,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
if (process.env.FENEXT_USER_DATA)
  app.setPath("userData", process.env.FENEXT_USER_DATA);
const origin = process.env.FENEXT_APP_URL || "http://127.0.0.1:4310";
const target = new URL(origin);
if (
  target.protocol !== "https:" &&
  !["127.0.0.1", "localhost"].includes(target.hostname)
)
  throw new Error("远程服务必须使用 HTTPS");
let main,
  quick,
  tray,
  quitting = false,
  busy = false,
  state = {},
  status = {},
  timer;
const configFile = () => path.join(app.getPath("userData"), "settings.json");
async function persist() {
  await fs.writeFile(configFile(), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
}
function trusted(event) {
  if (
    event.senderFrame !== event.sender.mainFrame ||
    new URL(event.senderFrame.url).origin !== target.origin
  )
    throw new Error("不受信任的页面");
}
function createWindow(isQuick = false) {
  const area = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea;
  const width = Math.min(isQuick ? 680 : 1440, Math.max(320, area.width - 48));
  const height = Math.min(isQuick ? 750 : 960, Math.max(320, area.height - 48));
  const w = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    minWidth: Math.min(isQuick ? 520 : 760, width),
    minHeight: Math.min(500, height),
    icon: path.join(__dirname, "assets", "icon.png"),
    title: "Fenext",
    backgroundColor: "#F6F5F4",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== target.origin) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  w.once("ready-to-show", () => w.show());
  w.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  w.loadURL(origin + (isQuick ? "/quick" : "/")).catch(() =>
    dialog.showErrorBox(
      "Fenext 服务未启动",
      "请先运行 npm start 和 npm run worker，或配置 FENEXT_APP_URL 指向已部署的 HTTPS 服务。",
    ),
  );
  return w;
}
function showMain() {
  if (!main || main.isDestroyed()) main = createWindow();
  main.show();
  main.focus();
}
function showQuick() {
  if (!quick || quick.isDestroyed()) quick = createWindow(true);
  quick.show();
  quick.focus();
}
function registerShortcut(value) {
  if (typeof value !== "string" || value.length > 80)
    throw new Error("快捷键格式不正确");
  const old = state.shortcut;
  if (old === value && globalShortcut.isRegistered(old)) return;
  let ok = false;
  try {
    ok = globalShortcut.register(value, showQuick);
  } catch {}
  if (!ok) throw new Error("快捷键被占用或格式无效，请换一个组合");
  if (old) globalShortcut.unregister(old);
  state.shortcut = value;
}
async function api(p, body) {
  const r = await net.fetch(origin + "/api" + p, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", Origin: target.origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "服务不可用");
  return data;
}
async function sync() {
  if (busy || !state.directory) return { ...state, ...status };
  busy = true;
  try {
    const { syncDirectory, exportMaterials } = await import("./sync.mjs");
    status = await syncDirectory(state.directory, api);
    if (!status.errors.length && !status.conflicts.length)
      await exportMaterials(state.directory, api, status.paths);
    status.lastSync = new Date().toISOString();
    status.error = status.errors.join("；");
    await api("/devices", {
      id: state.deviceId,
      name: os.hostname(),
      status: {
        summary: status.summary,
        error: status.error,
        conflicts: status.conflicts,
        lastSync: status.lastSync,
      },
    });
  } catch (e) {
    status.error = e.message;
  } finally {
    busy = false;
  }
  return { ...state, ...status };
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showMain);
  app.whenReady().then(async () => {
    app.setAboutPanelOptions({
      applicationName: "Fenext",
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: "把读到的资料，变成用得上的知识",
    });
    if (process.platform === "darwin")
      app.dock?.setIcon(path.join(__dirname, "assets", "icon.png"));
    try {
      state = JSON.parse(await fs.readFile(configFile(), "utf8"));
    } catch {
      state = { deviceId: crypto.randomUUID() };
    }
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    try {
      registerShortcut(
        state.shortcut ||
          (process.platform === "darwin" ? "Alt+Command+F" : "Control+Alt+F"),
      );
    } catch (e) {
      status.error = e.message;
    }
    tray = new Tray(
      nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png")),
    );
    tray.setToolTip("Fenext");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "打开 Fenext", click: showMain },
        { label: "快捷收集", click: showQuick },
        { label: "立即同步", click: () => void sync() },
        { type: "separator" },
        {
          label: "退出 Fenext",
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on("double-click", showMain);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Fenext",
          submenu: [
            { label: "关于 Fenext", click: () => app.showAboutPanel() },
            { label: "快捷收集", click: showQuick },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    const handle = (channel, fn) =>
      ipcMain.handle("fenext:" + channel, async (event, ...args) => {
        trusted(event);
        return fn(event, ...args);
      });
    handle("status", () => ({ ...state, ...status }));
    handle("open-main", showMain);
    handle("hide", (e) => BrowserWindow.fromWebContents(e.sender)?.hide());
    handle("shortcut", async (_e, value) => {
      registerShortcut(value);
      await persist();
      return { ok: true };
    });
    handle("connect-obsidian", async () => {
      const { registeredVaults, prepareVaultDirectory } =
        await import("./obsidian.mjs");
      const vaults = await registeredVaults(app.getPath("appData"));
      const suggested = vaults.find((vault) => vault.open) || vaults[0];
      let vaultPath = suggested?.path;
      if (suggested) {
        const choice = await dialog.showMessageBox(main, {
          type: "question",
          title: "连接 Obsidian",
          message: `将 Fenext 笔记放进「${suggested.name}」？`,
          detail:
            `${suggested.path}${path.sep}Fenext\n` +
            "同步完成后，在 Obsidian 左侧打开 Fenext → 知识。原有笔记不会自动导入 Fenext。",
          buttons: ["连接并同步", "选择其他知识库", "取消"],
          defaultId: 0,
          cancelId: 2,
        });
        if (choice.response === 2) return { ...state, ...status, cancelled: true };
        if (choice.response === 1) vaultPath = undefined;
      }
      if (!vaultPath) {
        const chosen = await dialog.showOpenDialog(main, {
          title: "选择 Obsidian 知识库文件夹（包含 .obsidian）",
          defaultPath: suggested?.path,
          properties: ["openDirectory"],
        });
        if (chosen.canceled) return { ...state, ...status, cancelled: true };
        vaultPath = chosen.filePaths[0];
        const confirm = await dialog.showMessageBox(main, {
          type: "question",
          title: "连接 Obsidian",
          message: "在所选知识库中建立 Fenext 文件夹并同步笔记？",
          detail:
            `${vaultPath}${path.sep}Fenext\n` +
            "原有笔记不会自动导入 Fenext。",
          buttons: ["连接并同步", "取消"],
          defaultId: 0,
          cancelId: 1,
        });
        if (confirm.response !== 0)
          return { ...state, ...status, cancelled: true };
      }
      const selected = await prepareVaultDirectory(vaultPath);
      state.directory = selected.directory;
      state.vaultPath = selected.vaultPath;
      state.vaultName = path.basename(selected.vaultPath);
      status = {};
      await persist();
      return sync();
    });
    handle("open-obsidian", async () => {
      if (!state.vaultPath || !state.directory)
        throw new Error("请先连接 Obsidian 知识库");
      await shell.openExternal(
        "obsidian://open?vault=" +
          encodeURIComponent(state.vaultName || path.basename(state.vaultPath)),
      );
      return { ok: true };
    });
    handle("sync", async () => {
      if (busy) throw new Error("同步正在进行，请稍后重试");
      if (!state.directory) throw new Error("请先连接 Obsidian 知识库");
      return sync();
    });
    handle("import", async () => {
      if (!state.directory) throw new Error("请先绑定专用目录");
      if (busy) throw new Error("同步正在进行，请稍后重试");
      const { scanNotes, parseNote, importDirectory } =
        await import("./sync.mjs");
      const files = (await scanNotes(state.directory)).filter(
        (f) => !parseNote(f.raw).meta.fenext_id,
      );
      const result = await dialog.showMessageBox(main, {
        type: "info",
        title: "导入已有 Markdown",
        message: `将 ${files.length} 篇未纳管 Markdown 加入当前账户？`,
        detail:
          "保留正文和自定义 YAML 字段，在原文件中增加 Fenext 身份；之后正文双向同步。既有本地附件不上传。",
        buttons: ["导入并同步", "取消"],
        defaultId: 1,
        cancelId: 1,
      });
      if (result.response !== 0) return { ...state, ...status };
      busy = true;
      try {
        await importDirectory(state.directory, api);
      } finally {
        busy = false;
      }
      return sync();
    });
    handle("open-note", async (_e, id) => {
      if (typeof id !== "string" || !status.paths?.[id] || !state.directory)
        throw new Error("此笔记尚未同步到本机，请先同步");
      const filename = path.resolve(state.directory, status.paths[id]);
      if (!filename.startsWith(state.directory + path.sep))
        throw new Error("路径不在绑定目录");
      await shell.openExternal(
        "obsidian://open?path=" + encodeURIComponent(filename),
      );
      return { ok: true };
    });
    showMain();
    timer = setInterval(() => void sync(), 30000);
    await persist();
  });
  app.on("activate", showMain);
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    quitting = true;
    clearInterval(timer);
    globalShortcut.unregisterAll();
  });
}
