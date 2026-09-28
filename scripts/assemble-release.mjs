import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const plugin = JSON.parse(
  await fs.readFile(path.join(root, "extension/manifest.json"), "utf8"),
);
const release = path.join(root, "release");
const output = path.join(release, `v${version}`);
const files = [
  {
    fileName: `Fenext-${version}-arm64-mac.zip`,
    kind: "desktop",
    platform: "macOS",
    arch: "arm64",
  },
  {
    fileName: `Fenext-Setup-${version}.exe`,
    sourceName: `Fenext Setup ${version}.exe`,
    kind: "desktop",
    platform: "Windows",
    arch: "x64",
  },
  {
    fileName: `Fenext-Web-${version}.zip`,
    kind: "web",
    platform: "Node.js 24 / Docker",
  },
  {
    fileName: `Fenext-Browser-${plugin.version}.zip`,
    kind: "extension",
    platform: "Chrome / Edge",
    version: plugin.version,
  },
];
// Require every advertised artifact before publishing the manifest.
for (const file of files)
  await fs.access(path.join(release, file.sourceName || file.fileName));
await fs.mkdir(output, { recursive: true });
const artifacts = [];
for (const file of files) {
  const source = path.join(release, file.sourceName || file.fileName);
  const bytes = await fs.readFile(source);
  await fs.copyFile(source, path.join(output, file.fileName));
  const { sourceName, ...published } = file;
  artifacts.push({
    ...published,
    version: file.version || version,
    size: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}
for (const name of [
  "Fenext-V1-发布说明.md",
  "Fenext-V1-安装与部署.md",
  "Fenext-版本索引.md",
  "Fenext-V1-验收记录.md",
]) {
  await fs.copyFile(path.join(root, "docs", name), path.join(output, name));
}
await fs.copyFile(
  path.join(root, "docs/Fenext-V1-验收记录.md"),
  path.join(output, "验收记录.md"),
);
await fs.copyFile(
  path.join(release, "extension-update.json"),
  path.join(output, "extension-update.json"),
);
await fs.writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      product: "Fenext",
      version,
      releaseDate: "2026-09-27",
      builtAt: new Date().toISOString(),
      distribution: "personal-use-unsigned",
      artifacts,
    },
    null,
    2,
  ) + "\n",
);
await fs.writeFile(
  path.join(output, "SHA256SUMS.txt"),
  artifacts.map((file) => `${file.sha256}  ${file.fileName}`).join("\n") + "\n",
);
console.log(`V${version} 发布目录：${output}`);
