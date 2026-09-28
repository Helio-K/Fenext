import emojiOptions from "../shared/emojis.json" with { type: "json" };
import packageInfo from "../package.json" with { type: "json" };
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { config, masterKey } from "./config.mjs";
import { extensionRelease } from "./extension-release.mjs";
import {
  confirmExtensionConnection,
  extensionConnectionStatus,
} from "./extension-connections.mjs";
import { openDB, id, now, parse, owned, tx } from "./db.mjs";
import {
  hash,
  passwordHash,
  passwordCheck,
  encrypt,
  providerURL,
  publicFetch,
} from "./security.mjs";
import {
  submit,
  taskJSON,
  noteJSON,
  applySuggestion,
  saveVersion,
  suggestion,
} from "./domain.mjs";
import { completion, chatAI } from "./ai.mjs";

const runFile = promisify(execFile);
const fail = (status, message) => Object.assign(new Error(message), { status });
const authInput = z.object({
  username: z.string().trim().min(2).max(60),
  password: z.string().min(10).max(200),
  client: z.enum(["browser", "mini"]).default("browser"),
  setupToken: z.string().optional(),
});
const publicUser = (u) => ({ id: u.id, username: u.username });
const jsonBody = async (req) => {
  let size = 0,
    chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw fail(413, "提交内容超过 12 MB 限制");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw fail(400, "请求格式不正确");
  }
};
const rates = new Map();
function rate(key, max, windowMs) {
  const time = Date.now();
  if (rates.size > 5000)
    for (const [k, v] of rates) if (v.until < time) rates.delete(k);
  const r = rates.get(key) || { count: 0, until: time + windowMs };
  if (r.until < time) {
    r.count = 0;
    r.until = time + windowMs;
  }
  r.count++;
  rates.set(key, r);
  if (r.count > max) throw fail(429, "操作过于频繁，请稍后再试");
}
function token(db, userId, kind = "session", label = "") {
  const t = crypto.randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO sessions(token_hash,user_id,expires_at,kind,label,created_at) VALUES(?,?,?,?,?,?)",
  ).run(
    hash(t),
    userId,
    kind === "ingestion"
      ? null
      : new Date(Date.now() + 7 * 86400000).toISOString(),
    kind,
    label,
    now(),
  );
  return t;
}
function authenticate(db, req) {
  const raw =
    req.headers.authorization?.replace(/^Bearer /, "") ||
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("fenext_session="))
      ?.slice(15);
  if (!raw) throw fail(401, "请先登录");
  const s = db
    .prepare(
      "SELECT * FROM sessions WHERE token_hash=? AND (expires_at>? OR (kind='ingestion' AND expires_at IS NULL))",
    )
    .get(hash(raw), now());
  if (!s) throw fail(401, "登录已失效，请重新登录");
  return s;
}
function cookie(res, value, expire = false) {
  res.setHeader(
    "Set-Cookie",
    `fenext_session=${value}; Path=/; HttpOnly; SameSite=Strict; ${config.origin.startsWith("https:") ? "Secure; " : ""}Max-Age=${expire ? 0 : 604800}`,
  );
}
const cleanSetting = (s) =>
  s
    ? {
        endpoint: s.endpoint,
        model: s.model,
        hasKey: !!s.key_cipher,
        validated: !!s.validated,
      }
    : null;

export function createServer(
  db = openDB(),
  { extensionDirectory, authRateMax = 12 } = {},
) {
  const userView = (uid) => ({
    ...publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(uid)),
    ...(db
      .prepare(
        "SELECT display_name AS displayName,avatar FROM profiles WHERE user_id=?",
      )
      .get(uid) || {}),
  });
  const taskView = (task) => {
    const view = taskJSON(task);
    view.icon =
      db
        .prepare(
          "SELECT emoji FROM material_icons WHERE user_id=? AND material_key=?",
        )
        .get(task.user_id, view.material.sourceKey || view.material.key)
        ?.emoji || "";
    if (view.result) {
      view.result.updates = view.result.updates.map((update) => ({
        ...update,
        status:
          db
            .prepare("SELECT status FROM suggestions WHERE id=? AND user_id=?")
            .get(update.id, task.user_id)?.status || "pending",
      }));
      view.result.pendingUpdates = view.result.updates.filter(
        (update) => update.status === "pending",
      ).length;
    }
    return view;
  };
  return http.createServer(async (req, res) => {
    const extensionOrigin =
      /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || "") &&
      /^\/api\/(?:tasks(?:\/[^/]+)?|integrations\/(?:connection|extension\/(?:latest|download)))$/.test(
        new URL(req.url, "http://localhost").pathname,
      );
    if (extensionOrigin) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Idempotency-Key",
      );
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' https://api.dictionaryapi.dev https://api.dictionaryapi.dev/ https://*.dictionaryapi.dev; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    const send = (data, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, "http://localhost"),
        p = url.pathname,
        method = req.method;
      if (method === "OPTIONS" && extensionOrigin) {
        res.writeHead(204);
        return res.end();
      }
      if (!p.startsWith("/api/")) {
        const root = path.resolve("dist");
        const candidate = path.resolve(root, "." + decodeURIComponent(p));
        if (candidate !== root && !candidate.startsWith(root + path.sep))
          throw fail(404, "页面不存在");
        let file = candidate;
        if (!fs.existsSync(file) || !fs.statSync(file).isFile())
          file = path.join(root, "index.html");
        if (!fs.existsSync(file))
          throw fail(503, "界面尚未构建，请运行 npm run build 或 npm run dev");
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        };
        res.writeHead(200, {
          "Content-Type":
            types[path.extname(file)] || "application/octet-stream",
        });
        fs.createReadStream(file).pipe(res);
        return;
      }
      if (!["GET", "HEAD"].includes(method)) {
        const allowed = config.origin
          ? [config.origin]
          : [
              "http://127.0.0.1:4310",
              "http://localhost:4310",
              "http://127.0.0.1:5173",
              "http://localhost:5173",
            ];
        if (
          req.headers.origin &&
          !allowed.includes(req.headers.origin) &&
          !extensionOrigin
        )
          throw fail(403, "请求来源不受信任");
        if (req.headers["sec-fetch-site"] === "cross-site" && !extensionOrigin)
          throw fail(403, "不允许跨站请求");
        if (
          !String(req.headers["content-type"] || "").startsWith(
            "application/json",
          )
        )
          throw fail(415, "请使用 JSON 请求");
      }
      if (p === "/api/health")
        return send({
          ok: true,
          service: "Fenext",
          version: packageInfo.version,
        });
      if (
        [
          "/api/integrations/extension/latest",
          "/api/integrations/extension/download",
        ].includes(p) &&
        method === "GET"
      ) {
        const release = extensionRelease(extensionDirectory);
        if (p.endsWith("/latest"))
          return send({
            version: release.version,
            changes: release.changes,
            downloadUrl: `/api/integrations/extension/download?version=${release.version}`,
          });
        if (
          url.searchParams.has("version") &&
          url.searchParams.get("version") !== release.version
        )
          throw fail(409, "插件版本已更新，请重新检查更新后下载");
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${release.fileName}"`,
          "Content-Length": release.size,
        });
        return res.end(release.bytes);
      }
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress,
      );
      const needsSetupToken =
        !!process.env.SETUP_TOKEN || !local || !!config.origin;
      const checkSetup = (body) => {
        if (
          process.env.SETUP_TOKEN
            ? body.setupToken !== process.env.SETUP_TOKEN
            : !local || !!config.origin
        )
          throw fail(403, "远程初始化需要管理员配置的 SETUP_TOKEN");
      };
      if (p === "/api/bootstrap" && method === "GET") {
        const needsSetup = !db.prepare("SELECT id FROM users LIMIT 1").get();
        return send({
          needsSetup,
          needsSetupToken: needsSetup && needsSetupToken,
          authMethods: { personal: true, wechat: false, sms: false },
        });
      }
      if (
        ["/api/setup", "/api/login", "/api/auth"].includes(p) &&
        method === "POST"
      ) {
        rate("auth:" + req.socket.remoteAddress, authRateMax, 60000);
        const body = authInput.parse(await jsonBody(req));
        let user,
          created = false;
        if (p === "/api/setup") {
          checkSetup(body);
          const password = await passwordHash(body.password);
          user = tx(db, () => {
            if (db.prepare("SELECT id FROM users LIMIT 1").get())
              throw fail(409, "已初始化，请登录");
            const user = { id: id(), username: body.username };
            db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
              user.id,
              user.username,
              password,
              now(),
            );
            return user;
          });
          created = true;
        } else {
          user = db
            .prepare("SELECT * FROM users WHERE username=?")
            .get(body.username);
          if (!user && p === "/api/auth") {
            const password = await passwordHash(body.password);
            user = tx(db, () => {
              // Another request may have registered this name while hashing.
              const existing = db
                .prepare("SELECT * FROM users WHERE username=?")
                .get(body.username);
              if (existing) return existing;
              if (!db.prepare("SELECT id FROM users LIMIT 1").get())
                checkSetup(body);
              const user = { id: id(), username: body.username };
              db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
                user.id,
                user.username,
                password,
                now(),
              );
              created = true;
              return user;
            });
          }
          if (
            !user ||
            (!created && !(await passwordCheck(body.password, user.password)))
          )
            throw fail(401, "账号或密码不正确");
        }
        const t = token(db, user.id);
        cookie(res, t);
        return send({
          user: userView(user.id),
          ...(p === "/api/auth" ? { created } : {}),
          ...(body.client === "mini" ? { token: t } : {}),
        });
      }
      const auth = authenticate(db, req),
        uid = auth.user_id;
      if (extensionOrigin && auth.kind !== "ingestion")
        throw fail(403, "浏览器插件需使用专用接收凭证");
      if (
        auth.kind === "ingestion" &&
        !(
          (p === "/api/tasks" && method === "POST") ||
          (/^\/api\/tasks\/[^/]+$/.test(p) && method === "GET") ||
          (p === "/api/integrations/connection" && method === "GET")
        )
      )
        throw fail(403, "此凭证仅允许提交资料与查询任务");
      if (p === "/api/integrations/connection" && method === "GET") {
        confirmExtensionConnection(db, auth, req, url);
        return send({ ok: true });
      }
      if (p === "/api/integrations/extension/status" && method === "GET")
        return send(extensionConnectionStatus(db, uid));
      if (p === "/api/me" && method === "GET") return send(userView(uid));
      if (p === "/api/me" && method === "PATCH") {
        const body = z
          .object({
            displayName: z.string().trim().min(1).max(40),
            avatar: z
              .string()
              .refine(
                (value) => value === "" || emojiOptions.avatars.includes(value),
              ),
          })
          .parse(await jsonBody(req));
        db.prepare(
          "INSERT INTO profiles VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,avatar=excluded.avatar",
        ).run(uid, body.displayName, body.avatar);
        return send(userView(uid));
      }
      const iconMatch = p.match(/^\/api\/tasks\/([^/]+)\/icon$/);
      if (iconMatch && method === "PATCH") {
        const task = owned(db, "tasks", iconMatch[1], uid);
        const { emoji } = z
          .object({
            emoji: z
              .string()
              .refine(
                (value) =>
                  value === "" || emojiOptions.materials.includes(value),
              ),
          })
          .parse(await jsonBody(req));
        const material = taskJSON(task).material;
        db.prepare(
          "INSERT INTO material_icons VALUES(?,?,?) ON CONFLICT(user_id,material_key) DO UPDATE SET emoji=excluded.emoji",
        ).run(uid, material.sourceKey || material.key, emoji);
        return send(taskView(task));
      }
      if (p === "/api/logout" && method === "POST") {
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
          auth.token_hash,
        );
        cookie(res, "", true);
        return send({ ok: true });
      }
      if (p === "/api/tasks" && method === "POST") {
        rate("submit:" + uid, 30, 60000);
        const task = submit(
          db,
          uid,
          await jsonBody(req),
          req.headers["idempotency-key"],
        );
        confirmExtensionConnection(db, auth, req, url);
        return send(taskView(task), 201);
      }
      if (p === "/api/tasks" && method === "GET")
        return send(
          db
            .prepare(
              "SELECT * FROM tasks WHERE user_id=? AND stage!='deleted' ORDER BY created_at DESC, rowid DESC",
            )
            .all(uid)
            .map(taskView),
        );
      let m = p.match(/^\/api\/tasks\/([^/]+)(?:\/(retry|cancel|images))?$/);
      if (m) {
        const t = owned(db, "tasks", m[1], uid);
        if (!m[2] && method === "DELETE") {
          db.prepare(
            "UPDATE tasks SET stage='deleted',fingerprint=?,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND user_id=?",
          ).run("deleted:" + t.id, now(), t.id, uid);
          return send({ ok: true });
        }
        if (m[2] === "images" && method === "GET") {
          const i = parse(t.input).images[
            Number(url.searchParams.get("index"))
          ];
          if (!i) throw fail(404, "图片不存在");
          const [prefix, data] = i.data.split(",");
          res.writeHead(200, { "Content-Type": prefix.slice(5, -7) });
          return res.end(Buffer.from(data, "base64"));
        }
        if (!m[2] && method === "GET") {
          const view = taskView(t);
          view.input.images = parse(t.input).images.map((image, index) => ({
            ...image,
            index,
          }));
          return send(view);
        }
        if (method === "POST" && m[2] === "cancel") {
          db.prepare(
            "UPDATE tasks SET stage='cancelled',lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND stage NOT IN ('completed','cancelled')",
          ).run(now(), t.id);
          return send(taskView(owned(db, "tasks", t.id, uid)));
        }
        if (method === "POST" && m[2] === "retry") {
          if (!["failed", "waiting_config", "cancelled"].includes(t.stage))
            throw fail(409, "当前阶段无需重试");
          const s = db
            .prepare("SELECT validated FROM settings WHERE user_id=?")
            .get(uid);
          db.prepare(
            "UPDATE tasks SET stage=?,error=NULL,attempts=0,next_at=0,lease=NULL,lease_until=NULL,updated_at=? WHERE id=?",
          ).run(s?.validated ? "queued" : "waiting_config", now(), t.id);
          return send(taskView(owned(db, "tasks", t.id, uid)));
        }
      }
      if (p === "/api/notes/import" && method === "POST") {
        const b = z
          .object({
            title: z.string().min(1).max(200),
            body: z.string().max(150000),
            aliases: z.array(z.string().max(150)).max(30).default([]),
            sourceKey: z.string().min(1).max(200),
          })
          .parse(await jsonBody(req));
        return send(
          tx(db, () => {
            const prior = db
              .prepare(
                "SELECT note_id FROM imports WHERE user_id=? AND source_key=?",
              )
              .get(uid, b.sourceKey);
            if (prior) return noteJSON(owned(db, "notes", prior.note_id, uid));
            const nid = id(),
              time = now();
            db.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
              nid,
              uid,
              b.title,
              JSON.stringify(b.aliases),
              "场景相关",
              "从用户选择的 Obsidian Markdown 导入，内容未经过 AI 审核。",
              "[]",
              b.body,
              1,
              time,
              time,
            );
            db.prepare("INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)").run(
              id(),
              nid,
              uid,
              1,
              b.body,
              "导入用户原始 Markdown",
              "obsidian-import",
              time,
            );
            db.prepare("INSERT INTO imports VALUES(?,?,?)").run(
              uid,
              b.sourceKey,
              nid,
            );
            return noteJSON(owned(db, "notes", nid, uid));
          }),
          201,
        );
      }
      if (p === "/api/sync/materials" && method === "GET") {
        return send(
          db
            .prepare(
              "SELECT DISTINCT tasks.id,tasks.title,tasks.input,tasks.checkpoint FROM tasks JOIN sources ON sources.task_id=tasks.id WHERE tasks.user_id=?",
            )
            .all(uid)
            .map((t) => ({
              id: t.id,
              title: t.title,
              input: parse(t.input),
              ranges: parse(t.checkpoint).read?.map((r) => r.range) || [],
            })),
        );
      }
      if (p === "/api/notes" && method === "GET") {
        const query = (url.searchParams.get("q") || "")
          .slice(0, 200)
          .toLocaleLowerCase();
        const mode = url.searchParams.get("mode");
        return send(
          db
            .prepare(
              "SELECT * FROM notes WHERE user_id=? ORDER BY updated_at DESC",
            )
            .all(uid)
            .map(noteJSON)
            .filter(
              (n) =>
                !query ||
                [n.title, ...n.aliases, ...n.questions, n.body]
                  .join(" ")
                  .toLocaleLowerCase()
                  .includes(query),
            )
            .map((n) => ({
              ...n,
              matchReason: query
                ? n.questions.find((q) =>
                    q.toLocaleLowerCase().includes(query),
                  ) || `与“${query}”相关的笔记内容`
                : mode === "questions"
                  ? n.questions[0]
                  : n.reason,
            })),
        );
      }
      m = p.match(/^\/api\/notes\/([^/]+)(?:\/(history|chat|restore|sync))?$/);
      if (m) {
        const n = owned(db, "notes", m[1], uid);
        if (!m[2] && method === "GET")
          return send({
            ...noteJSON(n),
            sources: db
              .prepare(
                "SELECT sources.*,tasks.title,tasks.input,tasks.checkpoint FROM sources JOIN tasks ON sources.task_id=tasks.id WHERE sources.note_id=? AND sources.user_id=?",
              )
              .all(n.id, uid)
              .map((s) => ({
                ...s,
                input: { url: parse(s.input).url },
                checkpoint: parse(s.checkpoint).read,
              })),
            suggestions: db
              .prepare(
                "SELECT * FROM suggestions WHERE note_id=? AND user_id=? ORDER BY created_at DESC",
              )
              .all(n.id, uid)
              .map((s) => ({ ...s, items: parse(s.items) })),
          });
        if (m[2] === "history" && method === "GET")
          return send(
            db
              .prepare(
                "SELECT * FROM versions WHERE note_id=? AND user_id=? ORDER BY version DESC",
              )
              .all(n.id, uid),
          );
        if (m[2] === "restore" && method === "POST") {
          const b = z
            .object({
              version: z.number().int(),
              baseVersion: z.number().int(),
            })
            .parse(await jsonBody(req));
          return send(
            noteJSON(
              tx(db, () => {
                const current = owned(db, "notes", n.id, uid);
                if (current.version !== b.baseVersion)
                  throw fail(409, "笔记已变化，请刷新后恢复");
                const v = db
                  .prepare(
                    "SELECT * FROM versions WHERE note_id=? AND user_id=? AND version=?",
                  )
                  .get(n.id, uid, b.version);
                if (!v) throw fail(404, "版本不存在");
                return saveVersion(
                  db,
                  current,
                  v.body,
                  `恢复至版本 ${b.version}`,
                  "restore",
                );
              }),
            ),
          );
        }
        if (m[2] === "sync" && method === "POST") {
          const b = z
            .object({
              body: z.string().max(150000),
              baseVersion: z.number().int().positive(),
            })
            .parse(await jsonBody(req));
          return send(
            tx(db, () => {
              const current = owned(db, "notes", n.id, uid);
              if (current.body === b.body) return { note: noteJSON(current) };
              if (current.version !== b.baseVersion) {
                const reason = "Obsidian 冲突 · " + hash(b.body).slice(0, 16);
                let s = db
                  .prepare(
                    "SELECT id FROM suggestions WHERE note_id=? AND user_id=? AND reason=? AND status='pending'",
                  )
                  .get(n.id, uid, reason);
                return {
                  conflict: true,
                  suggestionId:
                    s?.id || suggestion(db, current, b.body, reason),
                };
              }
              return {
                note: noteJSON(
                  saveVersion(
                    db,
                    current,
                    b.body,
                    "Obsidian 用户编辑",
                    "obsidian",
                  ),
                ),
              };
            }),
          );
        }
        if (m[2] === "chat" && method === "GET")
          return send(
            db
              .prepare(
                "SELECT * FROM messages WHERE note_id=? AND user_id=? ORDER BY created_at",
              )
              .all(n.id, uid),
          );
        if (m[2] === "chat" && method === "POST") {
          rate("chat:" + uid, 10, 60000);
          const b = z
            .object({
              text: z.string().trim().min(1).max(6000),
              mode: z.enum(["discuss", "edit"]).default("discuss"),
            })
            .parse(await jsonBody(req));
          db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)").run(
            id(),
            uid,
            n.id,
            "user",
            b.text,
            b.mode,
            now(),
          );
          try {
            const result = await chatAI(db, uid, n, b.text, b.mode);
            let changed = false,
              conflictId = null;
            tx(db, () => {
              if (
                result.action === "edit" &&
                b.mode === "edit" &&
                result.body
              ) {
                const current = owned(db, "notes", n.id, uid);
                if (current.version !== n.version) {
                  conflictId = suggestion(
                    db,
                    { ...n },
                    result.body,
                    result.answer,
                  );
                  result.answer +=
                    "\n笔记已发生变化，编辑成果已保存为建议，请重新比较。";
                } else {
                  saveVersion(db, current, result.body, b.text, "chat");
                  changed = true;
                }
              }
              db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)").run(
                id(),
                uid,
                n.id,
                "assistant",
                result.answer,
                changed
                  ? "edited"
                  : conflictId
                    ? "conflict"
                    : result.action === "clarify"
                      ? "clarify"
                      : "answer",
                now(),
              );
            });
            return send({ changed, conflictId, answer: result.answer });
          } catch (e) {
            db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)").run(
              id(),
              uid,
              n.id,
              "assistant",
              "编辑/回答失败，原文与指令已保留。请检查 AI 配置或稍后重试。",
              "error",
              now(),
            );
            throw e;
          }
        }
      }
      m = p.match(
        /^\/api\/suggestions\/([^/]+)(?:\/(accept|reject|recompare))?$/,
      );
      if (m) {
        const s = owned(db, "suggestions", m[1], uid);
        if (!m[2] && method === "GET")
          return send({
            ...s,
            items: parse(s.items),
            note: noteJSON(owned(db, "notes", s.note_id, uid)),
          });
        if (m[2] === "accept" && method === "POST") {
          const b = await jsonBody(req);
          return send(
            noteJSON(applySuggestion(db, uid, s.id, b.items, b.edited)),
          );
        }
        if (m[2] === "reject" && method === "POST") {
          db.prepare(
            "UPDATE suggestions SET status='rejected' WHERE id=? AND status='pending'",
          ).run(s.id);
          return send({ ok: true });
        }
        if (m[2] === "recompare" && method === "POST") {
          const current = owned(db, "notes", s.note_id, uid),
            items = parse(s.items).filter((i) => i.status === "pending");
          const result = await chatAI(
            db,
            uid,
            current,
            "请对照最新笔记重新整合以下待采用建议，保留用户最新编辑和原有内容。明确提出完整改稿，不添加无依据事实：" +
              JSON.stringify(items),
            "edit",
          );
          if (result.action !== "edit" || !result.body)
            throw fail(409, result.answer || "需要补充依据后重新比较");
          return send(
            tx(db, () => {
              if (
                owned(db, "notes", current.id, uid).version !== current.version
              )
                throw fail(409, "比较期间笔记再次变化，请重试");
              const sid = suggestion(
                db,
                current,
                result.body,
                s.reason,
                s.task_id,
              );
              db.prepare(
                "UPDATE suggestions SET status='superseded' WHERE id=?",
              ).run(s.id);
              return { id: sid, noteId: current.id };
            }),
          );
        }
      }
      if (p === "/api/settings" && method === "GET")
        return send({
          ai: cleanSetting(
            db.prepare("SELECT * FROM settings WHERE user_id=?").get(uid),
          ),
          limits: {
            text: 60000,
            images: 4,
            imageBytes: 2 * 1024 * 1024,
            pdfPages: 30,
            maxAttempts: config.maxAttempts,
          },
          capabilities: {
            wechat: false,
            sms: false,
            search: !!process.env.TAVILY_API_KEY,
            dictionary: true,
          },
          devices: db
            .prepare("SELECT * FROM devices WHERE user_id=?")
            .all(uid)
            .map((d) => ({ ...d, status: parse(d.status) })),
        });
      if (p === "/api/settings/ai" && method === "POST") {
        rate("config:" + uid, 10, 60000);
        const b = z
          .object({
            endpoint: z.string().max(400),
            model: z.string().min(1).max(150),
            key: z.string().max(500).optional(),
          })
          .parse(await jsonBody(req));
        const endpoint = providerURL(b.endpoint);
        const old = db
          .prepare("SELECT * FROM settings WHERE user_id=?")
          .get(uid);
        if (!b.key && !old) throw fail(400, "请填写 API Key");
        if (
          !b.key &&
          old &&
          new URL(old.endpoint).origin !== new URL(endpoint).origin
        )
          throw fail(
            400,
            "更换 AI 提供方时请重新填写对应密钥，不能跨提供方复用已保存密钥",
          );
        const keyCipher = b.key ? encrypt(b.key) : old.key_cipher;
        db.prepare(
          "INSERT INTO settings VALUES(?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET endpoint=excluded.endpoint,model=excluded.model,key_cipher=excluded.key_cipher,validated=0",
        ).run(uid, endpoint, b.model, keyCipher);
        await completion(
          { endpoint, model: b.model, key_cipher: keyCipher },
          [{ role: "user", content: 'Return JSON {"ok": true} only.' }],
          z.object({ ok: z.literal(true) }),
        );
        const validated = db
          .prepare(
            "UPDATE settings SET validated=1 WHERE user_id=? AND key_cipher=? AND model=? AND endpoint=?",
          )
          .run(uid, keyCipher, b.model, endpoint);
        if (!validated.changes)
          throw fail(409, "校验期间配置已被更换或移除，请使用最新配置重新校验");
        db.prepare(
          "UPDATE tasks SET stage='queued',error=NULL,next_at=0,attempts=0 WHERE user_id=? AND stage='waiting_config'",
        ).run(uid);
        return send({ ok: true });
      }
      if (p === "/api/settings/ai" && method === "DELETE") {
        db.prepare("DELETE FROM settings WHERE user_id=?").run(uid);
        return send({ ok: true });
      }
      if (p === "/api/integrations/extension/open" && method === "POST") {
        if (
          !local ||
          !["127.0.0.1", "localhost", "::1"].includes(config.host) ||
          (config.origin &&
            !["127.0.0.1", "localhost", "[::1]"].includes(
              new URL(config.origin).hostname,
            ))
        )
          throw fail(403, "请在运行 Fenext 的电脑上打开插件文件夹");
        rate("extension-folder:" + uid, 6, 60000);
        const directory = fileURLToPath(
          new URL("../extension/", import.meta.url),
        );
        if (!fs.existsSync(path.join(directory, "manifest.json")))
          throw fail(404, "插件文件夹不存在");
        const command =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "explorer.exe"
              : "xdg-open";
        await runFile(command, [directory], { timeout: 10000 });
        return send({ ok: true });
      }
      if (p === "/api/integrations/tokens" && method === "POST") {
        const body = z
          .object({ label: z.string().trim().max(80).default("") })
          .parse(await jsonBody(req));
        const raw = token(db, uid, "ingestion", body.label || "未命名凭证");
        const credential = db
          .prepare(
            "SELECT token_hash AS id,label,created_at,expires_at FROM sessions WHERE token_hash=?",
          )
          .get(hash(raw));
        return send({ ...credential, token: raw });
      }
      if (p === "/api/integrations/tokens" && method === "GET")
        return send(
          db
            .prepare(
              "SELECT token_hash AS id,label,created_at,expires_at FROM sessions WHERE user_id=? AND kind='ingestion' ORDER BY created_at DESC,rowid DESC",
            )
            .all(uid),
        );
      const credentialMatch = p.match(/^\/api\/integrations\/tokens\/([^/]+)$/);
      if (credentialMatch && ["PATCH", "DELETE"].includes(method)) {
        const credential = db
          .prepare(
            "SELECT token_hash FROM sessions WHERE user_id=? AND token_hash=? AND kind='ingestion'",
          )
          .get(uid, credentialMatch[1]);
        if (!credential) throw fail(404, "凭证不存在或已删除");
        if (method === "DELETE") {
          db.prepare(
            "DELETE FROM sessions WHERE user_id=? AND token_hash=? AND kind='ingestion'",
          ).run(uid, credentialMatch[1]);
        } else {
          const { label } = z
            .object({ label: z.string().trim().min(1).max(80) })
            .parse(await jsonBody(req));
          db.prepare(
            "UPDATE sessions SET label=? WHERE user_id=? AND token_hash=? AND kind='ingestion'",
          ).run(label, uid, credentialMatch[1]);
        }
        return send({ ok: true });
      }
      if (p === "/api/devices" && method === "POST") {
        const b = z
          .object({
            id: z.string().uuid(),
            name: z.string().max(100),
            status: z.record(z.string(), z.unknown()),
          })
          .parse(await jsonBody(req));
        const d = db
          .prepare("SELECT user_id FROM devices WHERE id=?")
          .get(b.id);
        if (d && d.user_id !== uid) throw fail(403, "设备不属于当前账户");
        db.prepare(
          "INSERT INTO devices VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at,status=excluded.status",
        ).run(b.id, uid, b.name, now(), JSON.stringify(b.status));
        return send({ ok: true });
      }
      if (p === "/api/supplement" && method === "POST") {
        rate("search:" + uid, 5, 60000);
        if (!process.env.TAVILY_API_KEY)
          throw fail(503, "外部检索尚未配置；可手动补充链接、正文或图片");
        const b = z
          .object({ noteId: z.string(), query: z.string().min(2).max(1000) })
          .parse(await jsonBody(req));
        const n = owned(db, "notes", b.noteId, uid);
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + process.env.TAVILY_API_KEY,
          },
          body: JSON.stringify({
            query: b.query,
            max_results: 3,
            include_raw_content: false,
          }),
        });
        if (!r.ok) throw fail(502, "补充检索失败，请稍后重试");
        const data = await r.json();
        const text = (data.results || [])
          .map(
            (r) =>
              `外部检索摘要（非全文）\n标题：${r.title}\n来源：${r.url}\n内容：${r.content}`,
          )
          .join("\n\n");
        if (!text) throw fail(404, "没有找到可补充的资料");
        return send(
          taskView(
            submit(
              db,
              uid,
              {
                text,
                title: `补充：${n.title}`,
                question: b.query,
                app: "用户触发外部补充",
              },
              req.headers["idempotency-key"],
            ),
          ),
        );
      }
      if (p === "/api/pronunciation" && method === "GET") {
        const term = url.searchParams.get("term") || "";
        if (!/^[a-zA-Z -]{1,60}$/.test(term))
          throw fail(400, "仅支持英文词典词条");
        try {
          const r = await publicFetch(
            "https://api.dictionaryapi.dev/api/v2/entries/en/" +
              encodeURIComponent(term),
            { maxBytes: 500000 },
          );
          const entry = JSON.parse(r.bytes.toString())[0];
          const phonetic = entry?.phonetics?.find((p) =>
            p.audio?.startsWith("https://api.dictionaryapi.dev/"),
          );
          return send({
            text: phonetic?.text || entry?.phonetic || "",
            audio: phonetic?.audio || null,
            source: "Free Dictionary API（词典读法，非官方术语读法）",
            url: "https://dictionaryapi.dev/",
          });
        } catch {
          throw fail(404, "暂无可核实读法；仍可查阅或搜索笔记");
        }
      }
      throw fail(404, "接口不存在");
    } catch (e) {
      if (!res.headersSent)
        send(
          {
            error:
              e.name === "ZodError"
                ? e.issues
                    .map((i) => i.message)
                    .slice(0, 3)
                    .join("；")
                : e.status || e.code || e.transient
                  ? e.message
                  : "操作未完成，资料已保留；请检查配置或稍后重试",
            ...(e.name === "ZodError" ? { code: "VALIDATION" } : {}),
          },
          e.status || (e.name === "ZodError" ? 400 : 500),
        );
      else res.end();
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  masterKey();
  const server = createServer();
  server.listen(config.port, config.host, () =>
    console.log(`Fenext 服务：http://${config.host}:${config.port}`),
  );
  process.on("SIGTERM", () => server.close());
}
