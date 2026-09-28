import { test, expect } from "@playwright/test";

test("插件验证后卡片与已打开弹窗自动变为已连接，删除凭证后同步失效", async ({
  page,
}) => {
  await page.request.post("/api/auth", {
    data: { username: "ui-source-connection", password: "fenext-e2e-password" },
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/sources");
  const card = page.getByRole("button").filter({
    has: page.getByRole("heading", { name: "电脑浏览器当前页", exact: true }),
  });
  await expect(card).toContainText("未连接");
  const created = await page.request.post("/api/integrations/tokens", {
    data: { label: "ui-browser-state" },
  });
  const { token } = await created.json();
  await card.click();
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("未连接");
  const confirmation = await page.request.get(
    "/api/integrations/connection?browser=chrome&version=0.1.5",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: `chrome-extension://${"d".repeat(32)}`,
      },
    },
  );
  expect(confirmation.status()).toBe(200);
  await expect(card).toContainText("已连接", { timeout: 8000 });
  await expect(modal).toContainText("Chrome 已连接");
  await expect(modal.getByText("下载并解压")).not.toBeVisible();
  await expect(
    modal.getByRole("link", { name: "下载 Chrome 版 Fenext插件" }),
  ).toBeVisible();
  await expect(
    modal.getByRole("link", { name: "下载 Edge 版 Fenext插件" }),
  ).toBeVisible();
  expect(
    await modal
      .locator(".modal-body")
      .evaluate((body) => body.scrollHeight > body.clientHeight + 2),
  ).toBe(false);
  await page.screenshot({
    path: ".local/qa/source-plugin-connected-modal.png",
  });
  await expect(
    modal.getByRole("link", { name: "生成接收凭证", exact: true }),
  ).toHaveCount(0);
  await expect(
    modal.getByRole("link", { name: "管理接收凭证", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: ".local/qa/source-plugin-connected.png" });
  const list = await (
    await page.request.get("/api/integrations/tokens")
  ).json();
  const linked = list.find((item: any) => item.label === "ui-browser-state");
  await page.request.delete(`/api/integrations/tokens/${linked.id}`, {
    data: {},
  });
  await expect(card).toContainText("凭证已失效", { timeout: 8000 });
  await card.click();
  await expect(page.getByRole("dialog")).toContainText("接收凭证已失效");
});
