import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
async function login(page: any) {
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("ui-test");
  await page.getByLabel("密码", { exact: true }).fill("fenext-e2e-password");
  await page.getByRole("button", { name: "进入知识空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "收集箱", exact: true }),
  ).toBeVisible();
}
test("收集箱删除确认可取消，确认后任务消失且详情无法读取", async ({ page }) => {
  await login(page);
  const response = await page.request.post("/api/tasks", {
    headers: { "Idempotency-Key": "ui-delete-task" },
    data: { text: "专用于验证删除交互的资料", title: "删除交互测试资料" },
  });
  const task = await response.json();
  await page.reload();
  const remove = page.getByRole("button", {
    name: "删除任务：删除交互测试资料",
    exact: true,
  });
  await remove.click();
  await page.getByRole("button", { name: "保留任务", exact: true }).click();
  await expect(remove).toBeVisible();
  await page.goto("/tasks/" + task.id);
  await page
    .getByRole("button", { name: "删除任务：删除交互测试资料", exact: true })
    .click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "收集箱", exact: true }),
  ).toBeVisible();
  await expect(remove).toHaveCount(0);
  expect((await page.request.get("/api/tasks/" + task.id)).status()).toBe(404);
});
test("真实登录、收集草稿恢复、接收后等待配置", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.getByRole("link", { name: "收集资料", exact: true }).click();
  await page
    .getByLabel("文字内容", { exact: true })
    .fill("自动化测试：保留一段产品判断资料");
  await page.goto("/");
  await page.goto("/collect");
  await expect(page.getByLabel("文字内容", { exact: true })).toHaveValue(
    "自动化测试：保留一段产品判断资料",
  );
  await page.getByRole("button", { name: "提交并整理" }).click();
  await expect(page.getByText("等待 AI 配置", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("自动化测试：保留一段产品判断资料", { exact: true }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("知识检索、原笔记导航、审核差异与历史恢复", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "知识库", exact: true }).first().click();
  await page.getByRole("textbox", { name: "搜索知识" }).fill("ReAct");
  await page.getByRole("heading", { name: "ReAct", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ReAct", exact: true }),
  ).toBeVisible();
  await page.getByText("有一份更新待查看").click();
  await expect(
    page.getByRole("heading", { name: "查看这次更新" }),
  ).toBeVisible();
  await expect(page.getByText("新增", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "接受所选更新" }).click();
  await expect(page.getByText("版本 2", { exact: true })).toBeVisible();
  await expect(
    page.getByText("行动循环仍需额外的停止、验证和状态机制。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "版本 1" }).click();
  await page.getByRole("button", { name: "恢复为新版本", exact: true }).click();
  await expect(page.getByText("版本 3", { exact: true })).toBeVisible();
});
test("设置、来源状态、术语与失败反馈可达；输出桌面和手机截图", async ({
  page,
}) => {
  await fs.mkdir(".local/qa", { recursive: true });
  await login(page);
  await page.screenshot({
    path: ".local/qa/desktop-inbox.png",
    fullPage: true,
  });
  await page.goto("/notes/ui-react");
  await page.getByRole("button", { name: "讨论 / 修改" }).click();
  await expect(page.getByText("作用范围", { exact: false })).toHaveCount(0);
  await page
    .getByPlaceholder("例如：这个方法适用于哪些产品场景？")
    .fill("这条知识有什么用途？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.screenshot({ path: ".local/qa/desktop-note.png", fullPage: true });
  await page.getByRole("button", { name: "关闭面板" }).click();
  await page.getByRole("button", { name: "工具调用", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.goto("/sources");
  await page
    .getByRole("button")
    .filter({ hasText: "电脑浏览器当前页" })
    .click();
  const browserModal = page.getByRole("dialog");
  await expect(
    browserModal.getByText("安装到浏览器", { exact: true }),
  ).toBeVisible();
  await expect(
    browserModal.getByRole("link", {
      name: "下载 Chrome 版 Fenext插件",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    "/api/integrations/extension/download?browser=chrome",
  );
  await expect(
    browserModal.getByRole("link", {
      name: "下载 Edge 版 Fenext插件",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/qa/browser-plugin-modal.png" });
  await browserModal.getByRole("link", { name: "生成接收凭证" }).click();
  await expect(page).toHaveURL(/settings\?tab=data/);
  await page.goto("/sources");
  await expect(
    page.getByRole("heading", { name: "来源与插件", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".source-plugin")).toHaveCount(3);
  await expect(page.locator(".plugin-head > span:not(.status)")).toHaveCount(0);
  for (const name of ["微信公众号", "飞书", "知乎"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(
      0,
    );
  }
  await expect(page.locator(".brand")).toHaveText("Fenext.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/knowledge");
  await expect(page.locator(".mobile-nav")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: ".local/qa/mobile-knowledge.png",
    fullPage: true,
  });
  await page.goto("/collect");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: ".local/qa/mobile-collect.png",
    fullPage: true,
  });
});

test("空整理结果可转为正文补充，保留原链接且不覆盖普通草稿", async ({
  page,
}) => {
  await login(page);
  await page.goto("/collect");
  await page.getByLabel("文字内容", { exact: true }).fill("保留我的另一份草稿");
  const url = "https://mp.weixin.qq.com/s/blocked-example";
  await page.route("**/api/tasks/blocked-example", (route) =>
    route.fulfill({
      json: {
        id: "blocked-example",
        title: "公众号资料",
        app: "Fenext",
        created_at: new Date().toISOString(),
        stage: "completed",
        question: "多智能体如何协作？",
        input: { url, text: "", images: [] },
        checkpoint: {},
        result: {
          new: [],
          existing: [],
          updates: [],
          uncertain: [],
          summary: "仅见环境异常验证页，未读取到文章正文。",
        },
      },
    }),
  );
  await page.goto("/tasks/blocked-example");
  await page.getByRole("button", { name: "粘贴正文或上传截图" }).click();
  await expect(page.getByLabel("文章或论文链接")).toHaveValue(url);
  await expect(
    page.getByRole("checkbox", { name: "链接仅作为来源记录，不读取链接" }),
  ).toBeChecked();
  await expect(page.getByRole("button", { name: "提交并整理" })).toBeDisabled();
  await page
    .getByLabel("文字内容", { exact: true })
    .fill("粘贴的公众号正文：多智能体需要明确任务分工与结果核验。");
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "链接仅作为来源记录，不读取链接" }),
  ).toBeChecked();
  await expect(page.getByLabel("文字内容", { exact: true })).toHaveValue(
    /粘贴的公众号正文/,
  );
  const receipt = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提交并整理" }).click();
  const task = await (await receipt).json();
  expect(task.input.urlMode).toBe("reference");
  expect(task.input.url).toBe(url);
  expect(task.question).toBe("多智能体如何协作？");
  await expect(page.getByText("等待 AI 配置", { exact: true })).toBeVisible();
  await page.goto("/collect");
  await expect(page.getByLabel("文字内容", { exact: true })).toHaveValue(
    "保留我的另一份草稿",
  );
});

test("历史拦截任务属于待你处理，列表与详情不再显示已完成", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "待你处理", exact: true }).click();
  const task = page.locator(".task-row").filter({
    has: page.getByRole("heading", {
      name: "未读到正文的公众号资料",
      exact: true,
    }),
  });
  await expect(task).toBeVisible();
  await expect(task.getByText("未读到正文", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "已完成", exact: true }).click();
  await expect(task).toHaveCount(0);
  await page.getByRole("button", { name: "待你处理", exact: true }).click();
  await task.locator(".task-title").click();
  await expect(
    page.getByRole("heading", { name: "读取未完成", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("未读到正文", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "整理结果", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "粘贴正文或上传截图" }),
  ).toBeVisible();
});
