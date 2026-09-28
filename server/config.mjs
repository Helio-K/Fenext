import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
try {
  process.loadEnvFile(".env");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 4310),
  dir: path.resolve(process.env.DATA_DIR || ".local"),
  origin: process.env.APP_ORIGIN || "",
  maxAttempts: Number(process.env.MAX_ATTEMPTS || 3),
  poll: Number(process.env.WORKER_POLL_MS || 1500),
  aiHosts: (
    process.env.AI_ALLOWED_HOSTS ||
    "api.openai.com,api.deepseek.com,dashscope.aliyuncs.com"
  )
    .split(",")
    .map((s) => s.trim()),
};
export function masterKey() {
  if (process.env.MASTER_KEY) {
    if (!/^[a-f0-9]{64}$/i.test(process.env.MASTER_KEY))
      throw new Error("MASTER_KEY 必须是 64 位十六进制字符串");
    return Buffer.from(process.env.MASTER_KEY, "hex");
  }
  if (config.host !== "127.0.0.1" && config.host !== "localhost")
    throw new Error("远程部署必须设置 MASTER_KEY");
  fs.mkdirSync(config.dir, { recursive: true, mode: 0o700 });
  const file = path.join(config.dir, "master.key");
  try {
    fs.writeFileSync(file, crypto.randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  return fs.readFileSync(file);
}
