import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fixture } from "./helpers.mjs";
import { createServer } from "../server/index.mjs";
import { hash } from "../server/security.mjs";
import { now, parse } from "../server/db.mjs";
const mini = { exports: {} };
vm.runInNewContext(fs.readFileSync("archive/miniprogram/lib/materials.js", "utf8"), {
  module: mini,
});
const { normalizeEntry } = mini.exports;

test("微信素材入口区分网页、文字和图片，并拒绝无效来源", () => {
  const entry = normalizeEntry(
    {},
    {
      scene: 1173,
      path: "pages/receive/index",
      forwardMaterials: [
        {
          type: "text/html",
          path: "https://mp.weixin.qq.com/s/article",
          name: "文章",
        },
        {
          type: "image/png",
          path: "wxfile://image.png",
          size: 1024,
          name: "段落.png",
        },
        {
          type: "text/plain",
          path: "wxfile://article.txt",
          size: 200,
          name: "文章.txt",
        },
      ],
    },
  );
  assert.equal(entry.source.url, "https://mp.weixin.qq.com/s/article");
  assert.equal(entry.source.files[0].type, "image/png");
  assert.deepEqual(JSON.parse(JSON.stringify(entry.source.textFiles)), [
    { path: "wxfile://article.txt", html: false },
  ]);
  assert.equal(entry.unsupported.length, 0);
  assert.equal(
    normalizeEntry({ url: encodeURIComponent("javascript:alert(1)") }, {})
      .source.url,
    "",
  );
  const bad = normalizeEntry(
    {},
    {
      scene: 1173,
      path: "pages/receive/index",
      forwardMaterials: [{ type: "application/pdf", path: "wxfile://a.pdf" }],
    },
  );
  assert.match(bad.unsupported[0], /暂不支持/);
});

test("浏览器插件仅凭接收凭证跨域提交已提取正文", async () => {
  const { db, uid } = fixture();
  const server = createServer(db);
  const raw = "test-ingestion-token";
  const origin = "chrome-extension://" + "a".repeat(32);
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,kind,label) VALUES(?,?,?,?,?)").run(
    hash(raw),
    uid,
    new Date(Date.now() + 86400000).toISOString(),
    "ingestion",
    "browser test",
  );
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,kind,label) VALUES(?,?,?,?,?)").run(
    hash("session-token"),
    uid,
    new Date(Date.now() + 86400000).toISOString(),
    "session",
    "test",
  );
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    const preflight = await fetch(base + "/api/tasks", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "authorization,content-type,idempotency-key",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    const connection = await fetch(base + "/api/integrations/connection", {
      headers: { Origin: origin, Authorization: "Bearer " + raw },
    });
    assert.equal(connection.status, 200);
    assert.equal(connection.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(await connection.json(), { ok: true });
    const invalidConnection = await fetch(
      base + "/api/integrations/connection",
      {
        headers: { Origin: origin, Authorization: "Bearer invalid-token" },
      },
    );
    assert.equal(invalidConnection.status, 401);
    const unauthorizedConnection = await fetch(
      base + "/api/integrations/connection",
      {
        headers: { Origin: origin, Authorization: "Bearer session-token" },
      },
    );
    assert.equal(unauthorizedConnection.status, 403);
    const body = {
      title: "浏览器文章",
      url: "https://mp.weixin.qq.com/s/article",
      text: "正文由已打开的浏览器页面提取。".repeat(5),
      urlMode: "reference",
      app: "Fenext 浏览器插件",
    };
    const send = (token, originValue, receipt) =>
      fetch(base + "/api/tasks", {
        method: "POST",
        headers: {
          Origin: originValue,
          "Sec-Fetch-Site": "cross-site",
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "Idempotency-Key": receipt,
        },
        body: JSON.stringify(body),
      });
    const submitted = await send(raw, origin, "browser-extension-1");
    assert.equal(submitted.status, 201);
    const task = await submitted.json();
    assert.equal(task.input.urlMode, "reference");
    assert.equal(task.input.url, body.url);
    assert.equal(
      parse(db.prepare("SELECT input FROM tasks WHERE id=?").get(task.id).input)
        .text,
      body.text,
    );
    assert.equal(
      (await send("session-token", origin, "browser-extension-2")).status,
      403,
    );
    assert.equal(
      (await send(raw, "https://untrusted.example", "browser-extension-3"))
        .status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test("小程序接收微信素材后提交已取得内容，链接仅记来源；仅链接则交给读取器", async () => {
  const payloads = [];
  const storage = new Map();
  let launch = {};
  let destination = "";
  const wx = {
    getEnterOptionsSync: () => launch,
    setStorageSync: (k, v) => storage.set(k, v),
    getStorageSync: (k) => storage.get(k),
    removeStorageSync: (k) => storage.delete(k),
    redirectTo: ({ url }) => {
      destination = url;
    },
    getFileSystemManager: () => ({
      readFile({ filePath, encoding, success }) {
        const data = filePath.endsWith(".txt")
          ? "这里是用户从微信转入的文章正文。"
          : "iVBORw0KGgo=";
        success({ data });
      },
    }),
  };
  const miniRequire = (id) =>
    id.includes("materials")
      ? mini.exports
      : {
          api: async (path, body) => {
            payloads.push({ path, body });
            return { id: "saved-task" };
          },
          authed: () => true,
          key: () => "stable-key",
          fail(page, e) {
            page.setData({ error: e.message, busy: false });
          },
        };
  let definition;
  vm.runInNewContext(
    fs.readFileSync("archive/miniprogram/pages/receive/index.js", "utf8"),
    {
      Page: (obj) => {
        definition = obj;
      },
      wx,
      require: miniRequire,
      Promise,
    },
  );
  function page() {
    return {
      ...definition,
      data: { ...definition.data },
      setData(change) {
        Object.assign(this.data, change);
      },
    };
  }
  launch = {
    scene: 1173,
    path: "pages/receive/index",
    forwardMaterials: [
      { type: "text/html", path: "https://mp.weixin.qq.com/s/example" },
      { type: "text/plain", path: "wxfile://article.txt", size: 80 },
      { type: "image/png", path: "wxfile://figure.png", size: 500 },
    ],
  };
  const rich = page();
  rich.onLoad({});
  await rich.submit();
  assert.equal(payloads[0].path, "/tasks");
  assert.equal(payloads[0].body.urlMode, "reference");
  assert.match(payloads[0].body.text, /用户从微信转入/);
  assert.equal(payloads[0].body.images.length, 1);
  assert.equal(destination, "/pages/task/index?id=saved-task");
  assert.equal(storage.has("fenext-pending-source"), false);
  launch = {
    scene: 1173,
    path: "pages/receive/index",
    forwardMaterials: [
      { type: "text/html", path: "https://mp.weixin.qq.com/s/only-link" },
    ],
  };
  const link = page();
  link.onLoad({});
  await link.submit();
  assert.equal(payloads[1].body.urlMode, "read");
  assert.equal(payloads[1].body.text, "");
});
