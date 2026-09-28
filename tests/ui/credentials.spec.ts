import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
test("凭证有备注和生成时间，长期有效，可修改备注并删除，删除立即断开", async ({
  page,
}) => {
  await page.request.post("/api/login", {
    data: { username: "ui-test", password: "fenext-e2e-password" },
  });
  await page.goto("/settings?tab=data");
  await page.getByLabel("凭证备注", { exact: false }).fill("Chrome · 工作电脑");
  const generated = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/integrations/tokens") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成接收凭证", exact: true }).click();
  const credential = await (await generated).json();
  expect(credential.expires_at).toBeNull();
  await expect(page.getByLabel("新接收凭证", { exact: true })).toHaveValue(
    credential.token,
  );
  const record = page
    .locator(".credential-record")
    .filter({ hasText: "Chrome · 工作电脑" });
  await expect(record).toContainText("长期有效");
  await expect(record.locator("time")).toHaveAttribute(
    "datetime",
    credential.created_at,
  );
  await record.getByRole("button", { name: "修改备注" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("备注", { exact: true })
    .fill("Edge · 家用电脑");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  const renamed = page
    .locator(".credential-record")
    .filter({ hasText: "Edge · 家用电脑" });
  await expect(renamed).toBeVisible();
  await fs.mkdir(".local/qa", { recursive: true });
  await page.screenshot({ path: ".local/qa/credentials-panel.png" });
  await page.reload();
  await expect(renamed).toBeVisible();
  await expect(page.getByLabel("新接收凭证", { exact: true })).toHaveCount(0);
  const connected = await page.request.get(
    "/api/integrations/connection?browser=edge",
    {
      headers: {
        Authorization: `Bearer ${credential.token}`,
        Origin: `chrome-extension://${"d".repeat(32)}`,
      },
    },
  );
  expect(connected.status()).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/qa/credentials-panel-mobile.png",
    fullPage: true,
  });
  await renamed.getByRole("button", { name: "删除", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "删除", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(renamed).toHaveCount(0);
  const status = await (
    await page.request.get("/api/integrations/extension/status")
  ).json();
  expect(status.state).toBe("expired");
  expect(
    (
      await page.request.get("/api/integrations/connection", {
        headers: { Authorization: `Bearer ${credential.token}` },
      })
    ).status(),
  ).toBe(401);
});
