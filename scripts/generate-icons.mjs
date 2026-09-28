// Format conversion only. The desktop source has transparent rounded corners;
// the existing web icon is intentionally independent.
// macOS tooling generates committed assets that can then be packaged on either OS.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const original = path.resolve(process.argv[2] || "public/fenext-icon.png");
const desktopSource = path.resolve("desktop/assets/icon-source.png");
const assets = path.resolve("desktop/assets"),
  iconset = path.resolve(".local/icons/Fenext.iconset");
await fs.mkdir("public", { recursive: true });
await fs.mkdir(assets, { recursive: true });
await fs.mkdir(iconset, { recursive: true });
if (original !== path.resolve("public/fenext-icon.png"))
  await fs.copyFile(original, "public/fenext-icon.png");
await fs.copyFile(desktopSource, path.join(assets, "icon.png"));
function resize(size, dest, source = desktopSource) {
  execFileSync(
    "sips",
    ["-z", String(size), String(size), source, "--out", dest],
    { stdio: "ignore" },
  );
}
for (const size of [16, 32, 128, 256, 512])
  for (const scale of [1, 2])
    resize(
      size * scale,
      path.join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
    );
execFileSync("iconutil", [
  "-c",
  "icns",
  iconset,
  "-o",
  path.join(assets, "icon.icns"),
]);
resize(32, "public/favicon-32.png", original);
resize(180, "public/apple-touch-icon.png", original);
resize(18, path.join(assets, "tray.png"), path.resolve("public/fenext-fox-transparent.png"));
const sizes = [16, 32, 48, 64, 128, 256],
  images = [];
for (const size of sizes) {
  const file = path.resolve(`.local/icons/windows-${size}.png`);
  resize(size, file);
  images.push(await fs.readFile(file));
}
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const p = 6 + i * 16;
  header[p] = size === 256 ? 0 : size;
  header[p + 1] = header[p];
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(images[i].length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += images[i].length;
});
await fs.writeFile(
  path.join(assets, "icon.ico"),
  Buffer.concat([header, ...images]),
);
console.log("Fenext icons generated for web, macOS, Windows and tray.");
