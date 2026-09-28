import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

const task = (
  id: string,
  key: string,
  question: string,
  stage: string,
  day: number,
  text = "正文",
) => ({
  id,
  title: key === "other" ? "另一篇资料" : "多智能体最佳实践",
  question,
  stage,
  material: {
    key,
    sourceKey: key === "other" ? "other" : "article",
    verified: true,
  },
  input: {
    text,
    images: [],
    url: "https://example.com/" + (key === "other" ? "other" : "article"),
  },
  checkpoint: {},
  app: "Fenext",
  created_at: `2026-09-${day}T08:00:00Z`,
  result:
    stage === "completed"
      ? { new: [{ id: "note", title: "协作" }], existing: [], updates: [] }
      : null,
});

test("资料按内容归组，最新问题置顶，筛选展开匹配问题，逐条删除且保留其他问题", async ({
  page,
}) => {
  let tasks = [
    task("old", "v1", "总结核心观点", "completed", 21),
    task("other", "other", "", "completed", 23),
    task("new", "v1", "如何用于我的产品？", "waiting_config", 24),
  ];
  await page.route("**/api/me", (r) =>
    r.fulfill({ json: { id: "group-test", username: "测试" } }),
  );
  await page.route("**/api/tasks", (r) => r.fulfill({ json: tasks }));
  await page.route("**/api/tasks/new", (r) => {
    if (r.request().method() === "DELETE")
      tasks = tasks.filter((t) => t.id !== "new");
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "全部资料", exact: true }),
  ).toHaveText("全部资料2");
  const group = page.getByRole("region", { name: "多智能体最佳实践" });
  const toggle = group.locator(".material-heading");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("最新问题：如何用于我的产品？");
  await expect(toggle).toContainText("2 条问题记录");
  await expect(page.locator(".task-list > :nth-child(2)")).toHaveClass(
    "material-group",
  );
  await toggle.click();
  await expect(
    group.getByRole("heading", { name: "总结核心观点" }),
  ).toBeVisible();
  await expect(group.getByText("新增 1 项", { exact: false })).toBeVisible();
  await expect(
    group.getByRole("link", { name: "查看任务：总结核心观点" }),
  ).toHaveAttribute("href", "/tasks/old");
  await page.getByRole("button", { name: "待你处理", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(group.locator(".question-row")).toHaveCount(1);
  await expect(
    group.getByRole("heading", { name: "如何用于我的产品？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "全部资料", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "全部资料", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("搜索收集资料").fill("核心观点");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(group.locator(".question-row")).toHaveCount(1);
  await expect(
    group.getByRole("heading", { name: "总结核心观点" }),
  ).toBeVisible();
  await page.getByLabel("搜索收集资料").fill("");
  await expect(group.locator(".question-row")).toHaveCount(2);
  await fs.mkdir(".local/qa", { recursive: true });
  await page.screenshot({ path: ".local/qa/inbox-grouped.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    group.getByRole("heading", { name: "如何用于我的产品？" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/qa/inbox-grouped-mobile.png",
    fullPage: true,
  });
  await group
    .getByRole("button", { name: "删除任务：如何用于我的产品？", exact: true })
    .click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(group).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "查看任务：多智能体最佳实践" }),
  ).toHaveAttribute("href", "/tasks/old");
  await expect(
    page.getByRole("button", { name: "待你处理", exact: true }),
  ).toHaveCount(0);
});

test("同链接不同内容显示版本，轮询新问题后资料移到顶部", async ({ page }) => {
  let tasks = [
    task("v1", "v1", "旧版问题", "completed", 21),
    task("v2", "v2", "新版问题", "completed", 22, "更新的正文"),
    task("other", "other", "", "completed", 23),
  ];
  await page.route("**/api/me", (r) =>
    r.fulfill({ json: { id: "versions", username: "测试" } }),
  );
  await page.route("**/api/tasks", (r) => r.fulfill({ json: tasks }));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "全部资料", exact: true }),
  ).toHaveText("全部资料3");
  await expect(
    page.getByText("旧版问题 · 内容版本 1 · 共 2 版", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("新版问题 · 内容版本 2 · 共 2 版", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("默认整理", { exact: true })).toBeVisible();
  tasks.push(task("followup", "v1", "再看旧版的应用", "extracting", 24));
  await expect(page.locator(".task-list > :nth-child(2)")).toHaveClass(
    "material-group",
    { timeout: 7000 },
  );
  await page.getByRole("button", { name: "处理中", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "再看旧版的应用" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "旧版问题" })).toHaveCount(0);
});

test("真实提交不同问题后返回收集箱归组，原文及问题各自保留", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("ui-test");
  await page.getByLabel("密码", { exact: true }).fill("fenext-e2e-password");
  await page.getByRole("button", { name: "进入知识空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "收集箱", exact: true }),
  ).toBeVisible();
  const ids: string[] = [];
  for (const question of ["核心是什么", "如何应用"]) {
    const response = await page.request.post("/api/tasks", {
      headers: { "Idempotency-Key": "group-" + ids.length },
      data: { text: "归组集成测试的独立正文", title: "归组集成文章", question },
    });
    expect(response.status()).toBe(201);
    const task = await response.json();
    ids.push(task.id);
    expect(task.material.verified).toBe(true);
  }
  expect(ids[0]).not.toBe(ids[1]);
  await page.reload();
  const group = page.getByRole("region", { name: "归组集成文章" });
  await group.locator(".material-heading").click();
  for (const [i, question] of ["核心是什么", "如何应用"].entries()) {
    await expect(
      group.getByRole("heading", { name: question, exact: true }),
    ).toBeVisible();
    const saved = await (await page.request.get("/api/tasks/" + ids[i])).json();
    expect(saved.question).toBe(question);
    expect(saved.input.text).toBe("归组集成测试的独立正文");
  }
});
