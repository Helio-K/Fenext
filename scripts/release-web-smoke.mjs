import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const archive = path.join(root, "release", `Fenext-Web-${version}.zip`);
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "fenext-release-smoke-"),
);
const directory = path.join(temporary, `Fenext-Web-${version}`);
let server, browser;
let logs = "";
const origin = "http://127.0.0.1:4312";
try {
  const entries = (await run("unzip", ["-Z1", archive])).stdout
    .trim()
    .split("\n");
  assert.ok(
    entries.every(
      (entry) => !/(^|\/)(\.local|node_modules|miniprogram)(\/|$)/.test(entry),
    ),
  );
  assert.ok(
    entries.every(
      (entry) => !entry.endsWith("/.env") && !/\.(sqlite|key)$/.test(entry),
    ),
  );
  await run("unzip", ["-q", archive, "-d", temporary]);
  console.log(
    "Archive allowlist verified; installing extracted production dependencies",
  );
  await run(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: directory, maxBuffer: 2 * 1024 * 1024 },
  );
  server = spawn(process.execPath, ["scripts/start-web.mjs"], {
    cwd: directory,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "4312",
      DATA_DIR: path.join(temporary, "data"),
      APP_ORIGIN: origin,
      SETUP_TOKEN: "release-test-setup-only",
      MASTER_KEY: "",
      TAVILY_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      logs += chunk;
    });
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error("Release server exited: " + logs);
    try {
      const response = await fetch(origin + "/api/health");
      const health = await response.json();
      if (
        response.ok &&
        health.version === version &&
        logs.includes("Fenext worker")
      ) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(healthy, "API and worker must both start");
  const auth = await fetch(origin + "/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      username: "release-smoke",
      password: "release-test-password",
      client: "mini",
      setupToken: "release-test-setup-only",
    }),
  });
  assert.equal(auth.status, 200);
  const { token } = await auth.json();
  const task = await fetch(origin + "/api/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": "release-smoke-material",
    },
    body: JSON.stringify({
      title: "V1 发布包隔离测试",
      text: "这是一条发布包隔离测试资料，不调用真实模型。",
    }),
  });
  assert.equal(task.status, 201);
  assert.equal((await task.json()).stage, "waiting_config");
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await page.goto(origin);
  await page.getByLabel("账号", { exact: true }).fill("release-smoke");
  await page.getByLabel("密码", { exact: true }).fill("release-test-password");
  await page.getByRole("button", { name: "进入知识空间", exact: true }).click();
  await page.getByRole("heading", { name: "收集箱", exact: true }).waitFor();
  await page.getByText("V1 发布包隔离测试", { exact: true }).first().waitFor();
  await fs.mkdir(path.join(root, ".local/qa"), { recursive: true });
  await page.screenshot({
    path: path.join(root, ".local/qa/web-v1-release.png"),
  });
  assert.ok(
    (await fs.stat(path.join(temporary, "data/fenext.sqlite"))).size > 0,
  );
  console.log(
    "Extracted V1 web package passed: production install, API + worker, health version, isolated persistent account/task, browser login and current inbox",
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const closed = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await closed;
  }
  await fs.rm(temporary, { recursive: true, force: true });
}
