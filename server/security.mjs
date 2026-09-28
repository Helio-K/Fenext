import crypto from "node:crypto";
import { promisify } from "node:util";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";
import { masterKey, config } from "./config.mjs";
const scrypt = promisify(crypto.scrypt);
export const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
export async function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(password, salt, 64)).toString("hex")}`;
}
export async function passwordCheck(password, stored) {
  const [salt, key] = stored.split(":");
  const actual = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(key, "hex"));
}
export function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  return Buffer.concat([
    iv,
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
export function decrypt(value) {
  const raw = Buffer.from(value, "base64");
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    raw.subarray(0, 12),
  );
  d.setAuthTag(raw.subarray(-16));
  return Buffer.concat([d.update(raw.subarray(12, -16)), d.final()]).toString();
}
export function publicAddress(address) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function publicURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("链接格式不正确");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("仅支持无凭证的公开 HTTP(S) 链接");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local"))
    throw new Error("不允许读取本地地址");
  return url;
}
const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true }).then((records) => {
        if (!records.length || records.some((r) => !publicAddress(r.address)))
          return callback(new Error("不允许读取内网或保留地址"));
        callback(
          null,
          options.all ? records : records[0].address,
          records[0].family,
        );
      }, callback);
    },
  },
});
export async function publicFetch(value, { maxBytes = 8 * 1024 * 1024 } = {}) {
  let url = publicURL(value);
  for (let n = 0; n < 5; n++) {
    const res = await request(url, {
      dispatcher,
      maxRedirections: 0,
      headersTimeout: 15000,
      bodyTimeout: 20000,
      signal: AbortSignal.timeout(30000),
      headers: { "user-agent": "Fenext/0.1 (personal knowledge reader)" },
    });
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      await res.body.dump();
      if (!res.headers.location) throw new Error("来源重定向缺少目标");
      url = publicURL(new URL(res.headers.location, url).href);
      continue;
    }
    if (res.statusCode >= 400) {
      await res.body.dump();
      throw new Error(
        `来源读取失败（HTTP ${res.statusCode}），可粘贴正文或补充图片`,
      );
    }
    const parts = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) {
        res.body.destroy();
        throw new Error("资料超过 8 MB 限制，请拆分提交");
      }
      parts.push(chunk);
    }
    return {
      bytes: Buffer.concat(parts),
      type: String(res.headers["content-type"] || ""),
      url: url.href,
    };
  }
  throw new Error("来源重定向次数过多");
}
export function providerURL(endpoint) {
  const u = new URL(endpoint);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (u.port && !["443"].includes(u.port)) ||
    !config.aiHosts.includes(u.hostname)
  )
    throw new Error("AI 地址必须使用服务端允许的 HTTPS 提供方");
  return u.href.replace(/\/$/, "");
}
