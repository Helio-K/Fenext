import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const root = fileURLToPath(new URL("../release/", import.meta.url));
const schema = z.object({
  version: z
    .string()
    .regex(/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/)
    .refine((v) => v.split(".").every((n) => Number(n) <= 65535)),
  changes: z.array(z.string().max(200)).min(1).max(20),
  size: z
    .number()
    .int()
    .positive()
    .max(12 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export function extensionRelease(directory = root) {
  try {
    const metadata = schema.parse(
      JSON.parse(
        fs.readFileSync(path.join(directory, "extension-update.json"), "utf8"),
      ),
    );
    const fileName = `Fenext-Browser-${metadata.version}.zip`;
    const bytes = fs.readFileSync(path.join(directory, fileName));
    if (
      bytes.length !== metadata.size ||
      crypto.createHash("sha256").update(bytes).digest("hex") !==
        metadata.sha256
    )
      throw new Error("插件安装包校验失败");
    return { ...metadata, fileName, bytes };
  } catch {
    throw Object.assign(new Error("插件更新暂不可用，请稍后再试"), {
      status: 503,
    });
  }
}
