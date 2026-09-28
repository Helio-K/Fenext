import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ZipFile } from "yazl";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function packageExtension(
  source = path.join(root, "extension"),
  output = path.join(root, "release"),
) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(source, "manifest.json"), "utf8"),
  );
  const notes = JSON.parse(
    await fs.readFile(path.join(source, "release-notes.json"), "utf8"),
  );
  const version = manifest.version;
  if (
    !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version) ||
    version.split(".").some((n) => Number(n) > 65535)
  )
    throw new Error("插件版本号不符合浏览器要求");
  if (
    notes.version !== version ||
    !Array.isArray(notes.changes) ||
    !notes.changes.length ||
    notes.changes.length > 20 ||
    notes.changes.some((v) => typeof v !== "string" || v.length > 200)
  )
    throw new Error("请为当前插件版本填写更新说明");
  const zip = new ZipFile();
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    zip.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("end", resolve);
  });
  async function add(directory, prefix = "extension") {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name, "en"),
    );
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const filename = path.join(directory, entry.name);
      const archivePath = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await add(filename, archivePath);
      else if (entry.isFile())
        zip.addBuffer(await fs.readFile(filename), archivePath, {
          mtime: new Date("2020-01-01T00:00:00Z"),
          mode: 0o100644,
        });
      else throw new Error("插件目录不能包含符号链接或特殊文件");
    }
  }
  await add(source);
  zip.end();
  await done;
  const bytes = Buffer.concat(chunks);
  if (bytes.length > 12 * 1024 * 1024)
    throw new Error("插件安装包超过大小限制");
  const fileName = `Fenext-Browser-${version}.zip`;
  const metadata = {
    version,
    fileName,
    changes: notes.changes,
    size: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, fileName + ".tmp"), bytes);
  await fs.rename(
    path.join(output, fileName + ".tmp"),
    path.join(output, fileName),
  );
  // Publish the version only after its complete archive is available.
  await fs.writeFile(
    path.join(output, "extension-update.json.tmp"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  await fs.rename(
    path.join(output, "extension-update.json.tmp"),
    path.join(output, "extension-update.json"),
  );
  await fs.cp(source, path.join(output, "extension"), { recursive: true });
  return metadata;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const release = await packageExtension();
  console.log(
    `已发布 Fenext插件 ${release.version}：release/${release.fileName}`,
  );
}
