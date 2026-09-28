import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
const credentials = { username: "ui-test", password: "fenext-e2e-password" };
async function fill(page: any) {
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
}
test("统一入口自动注册新账号，退出后通过同一按钮登录", async ({ page }) => {
  const username = "new-ui-account";
  await page.goto("/");
  await expect(page.getByText("账号登录", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "创建知识空间", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "进入知识空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "配置你的知识空间", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "个人菜单", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "进入知识空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "收集箱", exact: true }),
  ).toBeVisible();
});
test("已有账号密码错误时保留输入，改正密码后可直接进入", async ({ page }) => {
  await page.goto("/");
  await fill(page);
  await page.getByLabel("密码", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "进入知识空间", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("账号或密码不正确");
  await expect(page.getByLabel("账号", { exact: true })).toHaveValue(
    credentials.username,
  );
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue(
    "incorrect-password",
  );
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "进入知识空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "收集箱", exact: true }),
  ).toBeVisible();
});
test("全尺寸与较矮窗口中导航、账户、底部卡片和登录表单可访问", async ({
  page,
}) => {
  await fs.mkdir(".local/qa", { recursive: true });
  await page.goto("/");
  await fill(page);
  await page.getByRole("button", { name: "进入知识空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "收集箱", exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [1440, 960],
    [1280, 720],
    [1024, 640],
    [900, 540],
    [760, 500],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/sources");
    await expect(page.locator(".brand-icon")).toBeVisible();
    await page.getByRole("button", { name: "个人菜单", exact: true }).click();
    const logout = page.getByRole("button", { name: "退出登录", exact: true });
    await expect(logout).toBeInViewport();
    await expect(
      page.getByRole("link", { name: "设置与同步", exact: true }),
    ).toBeInViewport();
    await page.keyboard.press("Escape");
    const last = page.getByRole("button").filter({
      has: page.getByRole("heading", { name: "电脑浏览器当前页", exact: true }),
    });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (width === 1280 || width === 900)
      await page.screenshot({
        path: `.local/qa/window-${width}x${height}.png`,
      });
  }
  await page.getByRole("button", { name: "个人菜单", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "进入知识空间", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "数据处理与隐私说明" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "数据处理与隐私说明" }),
  ).toBeInViewport();
  expect(await page.locator('link[rel="icon"]').getAttribute("href")).toBe(
    "/favicon-32.png",
  );
  await expect
    .poll(() =>
      page
        .locator(".brand-icon")
        .evaluate((im: HTMLImageElement) => im.complete && im.naturalWidth > 0),
    )
    .toBe(true);
  await page.screenshot({ path: ".local/qa/login-window.png", fullPage: true });
});
