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
test("资料 emoji 保存后同组共用，刷新保留，选择图标不打开详情或折叠分组", async ({
  page,
}) => {
  await login(page);
  for (const question of ["一", "二"])
    await page.request.post("/api/tasks", {
      headers: { "Idempotency-Key": "emoji-" + encodeURIComponent(question) },
      data: { text: "图标归组测试内容", title: "图标测试", question },
    });
  await page.reload();
  const group = page.getByRole("region", { name: "图标测试", exact: true });
  await group.getByRole("button", { name: "更换资料图标：图标测试" }).click();
  await page.getByRole("button", { name: "🧠", exact: true }).click();
  await page.getByRole("button", { name: "保存图标", exact: true }).click();
  await expect(
    group.getByRole("button", { name: "更换资料图标：图标测试" }),
  ).toHaveText("🧠");
  await expect(group.locator(".material-heading")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.reload();
  await expect(
    group.getByRole("button", { name: "更换资料图标：图标测试" }),
  ).toHaveText("🧠");
  await group.getByRole("button", { name: "更换资料图标：图标测试" }).click();
  await page.getByRole("button", { name: "使用默认图标" }).click();
  await page.getByRole("button", { name: "保存图标", exact: true }).click();
  await expect(
    group
      .getByRole("button", { name: "更换资料图标：图标测试" })
      .locator("svg"),
  ).toBeVisible();
});

test("个人菜单整合设置和退出，编辑头像昵称后刷新和登录均保留", async ({
  page,
}) => {
  await login(page);
  await expect(
    page
      .locator(".sidebar")
      .getByRole("link", { name: "设置与同步", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "个人菜单", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "个人菜单" })).toBeVisible();
  await expect(page.getByText("剩余用量", { exact: true })).toHaveCount(0);
  await expect(page.getByText("显示宠物", { exact: true })).toHaveCount(0);
  await fs.mkdir(".local/qa", { recursive: true });
  await page.screenshot({ path: ".local/qa/account-menu.png" });
  await page.getByRole("button", { name: "编辑个人资料", exact: true }).click();
  await page.getByLabel("昵称", { exact: true }).fill("April 的知识空间");
  await page.getByRole("button", { name: "🦊", exact: true }).click();
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await expect(page.locator(".account-trigger")).toContainText(
    "April 的知识空间",
  );
  await page.reload();
  await expect(page.locator(".account-trigger .avatar")).toHaveText("🦊");
  await page.getByRole("button", { name: "个人菜单", exact: true }).click();
  await page.getByRole("link", { name: "设置与同步", exact: true }).click();
  await expect(page).toHaveURL(/settings/);
  await expect(page.getByRole("dialog", { name: "个人菜单" })).toHaveCount(0);
  await page.getByRole("button", { name: "个人菜单", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "个人菜单", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "个人菜单", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await login(page);
  await expect(page.locator(".account-trigger")).toContainText(
    "April 的知识空间",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "个人菜单", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "设置与同步", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "编辑个人资料", exact: true }).click();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
    "April 的知识空间",
  );
  await page.screenshot({ path: ".local/qa/profile-mobile.png" });
});

test("知识库吸顶后切换视图与加载均保持位置，页面内容正常滚动", async ({
  page,
}) => {
  const notes = Array.from({ length: 45 }, (_, i) => ({
    id: String(i),
    title: `知识 ${i}`,
    aliases: [],
    level: "基础必学",
    reason: "产品问题与概念的关系",
    updated_at: "2026-09-27T08:00:00Z",
  }));
  await page.route("**/api/me", (r) =>
    r.fulfill({ json: { id: "scroll", username: "test" } }),
  );
  await page.route("**/api/notes?*", async (r) => {
    if (r.request().url().includes("questions"))
      await new Promise((resolve) => setTimeout(resolve, 300));
    await r.fulfill({
      json: r.request().url().includes("questions") ? notes.slice(0, 3) : notes,
    });
  });
  await page.goto("/knowledge");
  await expect(page.locator(".knowledge-card")).toHaveCount(45);
  await page.evaluate(() => window.scrollTo(0, 600));
  const controls = page.locator(".knowledge-controls");
  await expect
    .poll(async () => Math.round((await controls.boundingBox())!.y))
    .toBe(0);
  const before = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "按产品问题", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "按产品问题", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await expect(page.locator(".knowledge-results")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await page.getByRole("button", { name: "按概念", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "按概念", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await fs.mkdir(".local/qa", { recursive: true });
  await page.screenshot({ path: ".local/qa/knowledge-sticky.png" });
  await page.mouse.move(1100, 650);
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(before);
  await expect
    .poll(async () => Math.round((await controls.boundingBox())!.y))
    .toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(async () => Math.round((await controls.boundingBox())!.y))
    .toBe(0);
  await page.screenshot({ path: ".local/qa/knowledge-sticky-mobile.png" });
});
