// Keep the original pixel-art fox untouched while giving desktop icons a
// macOS-style rounded tile with genuinely transparent outside corners.
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const fox = await fs.readFile(path.join(root, "public/fenext-fox-transparent.png"));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const png = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    ctx.shadowColor = "rgba(57, 47, 33, .13)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 9;
    ctx.fillStyle = "#f8f5ee";
    ctx.beginPath();
    ctx.roundRect(44, 38, 936, 936, 218);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(85, 73, 52, .12)";
    ctx.stroke();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 110, 110, 804, 804);
    return canvas.toDataURL("image/png").split(",")[1];
  }, `data:image/png;base64,${fox.toString("base64")}`);
  await fs.writeFile(
    path.join(root, "desktop/assets/icon-source.png"),
    Buffer.from(png, "base64"),
  );
} finally {
  await browser.close();
}
console.log("Rounded desktop icon source generated.");
