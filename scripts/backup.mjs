import fs from "node:fs";
import path from "node:path";
import { config, masterKey } from "../server/config.mjs";
import { openDB } from "../server/db.mjs";
const target = path.resolve(
  process.argv[2] ||
    path.join(
      config.dir,
      "backups",
      new Date().toISOString().replace(/[:.]/g, "-"),
    ),
);
fs.mkdirSync(target, { recursive: true, mode: 0o700 });
const db = openDB();
try {
  db.prepare("VACUUM INTO ?").run(path.join(target, "fenext.sqlite"));
  fs.chmodSync(path.join(target, "fenext.sqlite"), 0o600);
  fs.writeFileSync(path.join(target, "master.key"), masterKey(), {
    flag: "wx",
    mode: 0o600,
  });
  console.log("一致性备份已保存到：" + target);
} finally {
  db.close();
}
