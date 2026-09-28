import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("Chrome 和 Edge 提供真实下载链接，菜单安装与连接步骤无需复制内部地址", async ({
  page,
}) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { id: "guide", username: "test" } }),
  );
  await page.route("**/api/integrations/extension/status", (route) =>
    route.fulfill({ json: { state: "disconnected", connections: [] } }),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/sources");
  await page
    .getByRole("button")
    .filter({ hasText: "电脑浏览器当前页" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "复制地址", exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toContainText("管理扩展程序");
  await expect(dialog).toContainText("连接并继续");
  await expect(dialog.locator("strong")).toHaveText([
    "下载并解压",
    "安装到浏览器",
    "连接 Fenext",
  ]);
  const hasInternalScroll = () =>
    dialog
      .locator(".modal-body")
      .evaluate((body) => body.scrollHeight > body.clientHeight + 2);
  expect(await hasInternalScroll()).toBe(false);
  for (const browser of ["Chrome", "Edge"]) {
    const link = dialog.getByRole("link", {
      name: `下载 ${browser} 版 Fenext插件`,
      exact: true,
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      link.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^Fenext-Browser-.*\.zip$/);
    const file = await download.path();
    expect((await fs.readFile(file!)).subarray(0, 2).toString()).toBe("PK");
  }
  await fs.mkdir(".local/qa", { recursive: true });
  await page.screenshot({ path: ".local/qa/extension-install-links.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("link", { name: "下载 Edge 版 Fenext插件" }),
  ).toBeVisible();
  expect(await hasInternalScroll()).toBe(false);
  await page.screenshot({
    path: ".local/qa/extension-install-links-mobile.png",
  });
  await dialog
    .getByRole("link", { name: "生成接收凭证", exact: true })
    .click();
  await expect(page).toHaveURL(/settings\?tab=data/);
});
