import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipFile } from "yazl";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const extension = JSON.parse(
  await fs.readFile(path.join(root, "release/extension-update.json"), "utf8"),
);
const output = path.join(root, "release", `Fenext-Web-${pkg.version}.zip`);
const prefix = `Fenext-Web-${pkg.version}`;
// Explicit allowlist: never package .env, databases, user files or prior releases.
const entries = [
  "dist",
  "server",
  "shared",
  "src",
  "public",
  "extension",
  "package.json",
  "package-lock.json",
  "index.html",
  "tsconfig.json",
  "vite.config.ts",
  "Dockerfile",
  "compose.yaml",
  ".dockerignore",
  ".env.example",
  "scripts/start-web.mjs",
  "scripts/backup.mjs",
  "scripts/package-extension.mjs",
  "docs/Fenext-V1-发布说明.md",
  "docs/Fenext-V1-安装与部署.md",
  "docs/Fenext-版本索引.md",
  "docs/Fenext-V1-验收记录.md",
  "release/extension-update.json",
  `release/${extension.fileName}`,
];
const zip = new ZipFile();
await fs.mkdir(path.dirname(output), { recursive: true });
const done = new Promise((resolve, reject) => {
  const stream = createWriteStream(output + ".tmp");
  zip.on("error", reject);
  zip.outputStream.on("error", reject);
  stream.on("error", reject);
  stream.on("close", resolve);
  zip.outputStream.pipe(stream);
});
async function add(relative) {
  const filename = path.join(root, relative);
  const stat = await fs.lstat(filename);
  if (stat.isDirectory()) {
    for (const entry of (await fs.readdir(filename)).sort()) {
      if (!entry.startsWith(".")) await add(path.join(relative, entry));
    }
  } else if (stat.isFile()) {
    zip.addFile(filename, `${prefix}/${relative.split(path.sep).join("/")}`);
  } else {
    throw new Error(`发布包不允许包含符号链接或特殊文件：${relative}`);
  }
}
for (const entry of entries) await add(entry);
zip.addBuffer(
  Buffer.from(
    `# Fenext 网页端 V${pkg.version}\n\n需要 Node.js 24.16+。\n\n1. 在此目录运行 npm ci --omit=dev --ignore-scripts\n2. 运行 npm run web（同时启动 API 与后台处理）\n3. 打开 http://127.0.0.1:4310\n\n服务器部署、升级与备份见 docs/Fenext-V1-安装与部署.md。\n本包不含用户数据、密钥、模型配置或已部署服务。\n`,
  ),
  `${prefix}/README.md`,
);
zip.end();
await done;
await fs.rename(output + ".tmp", output);
console.log(`网页端发布包：${output}`);
