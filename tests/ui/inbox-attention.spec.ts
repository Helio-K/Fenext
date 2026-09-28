import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
const task = (id: string, title: string, stage: string) => ({
  id,
  title,
  stage,
  input: { images: [], url: "" },
  checkpoint: {},
  app: "Fenext",
  created_at: "2026-09-27T08:00:00Z",
});
test("待你处理包含失败与等待配置，计数不受搜索影响，清空后隐藏并返回全部", async ({
  page,
}) => {
  let tasks = [
    task("failed", "读取失败的文章", "failed"),
    task("config", "等待配置的文章", "waiting_config"),
    task("active", "正在整理的文章", "extracting"),
    task("done", "完成的文章", "completed"),
  ];
  await page.route("**/api/me", (r) =>
    r.fulfill({ json: { id: "attention-test", username: "测试" } }),
  );
  await page.route("**/api/tasks", (r) => r.fulfill({ json: tasks }));
  await page.goto("/");
  const attention = page.getByRole("button", { name: "待你处理", exact: true });
  await expect(attention).toHaveText("待你处理2");
  await attention.click();
  await expect(page.locator(".task-row")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "等待配置的文章" }),
  ).toBeVisible();
  await page.getByLabel("搜索收集资料").fill("读取失败");
  await expect(page.locator(".task-row")).toHaveCount(1);
  await expect(attention).toHaveText("待你处理2");
  await page.getByLabel("搜索收集资料").fill("");
  await page.getByRole("button", { name: "处理中", exact: true }).click();
  await expect(page.locator(".task-row")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "正在整理的文章" }),
  ).toBeVisible();
  await page.goto("/?status=failed&q=文章");
  await expect(attention).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/status=attention/);
  await fs.mkdir(".local/qa", { recursive: true });
  await page.screenshot({ path: ".local/qa/inbox-attention.png" });
  tasks = tasks.map((t) => ({ ...t, stage: "completed" }));
  await expect(attention).toHaveCount(0, { timeout: 7000 });
  await expect(
    page.getByRole("button", { name: "全部资料", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("搜索收集资料")).toHaveValue("文章");
  await expect(page.locator(".task-row")).toHaveCount(4);
  await expect(page).toHaveURL(/status=all/);
});
