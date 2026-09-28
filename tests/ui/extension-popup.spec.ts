import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const manifest = JSON.parse(
  await fs.readFile("extension/manifest.json", "utf8"),
);
const service = "http://127.0.0.1:4311";
const text = "多智能体的任务应明确分工、共享状态，并核验执行结果。".repeat(160);
async function popup(page: any, connected = false, version = manifest.version) {
  await page.route("**/test-extension/**", async (route: any) => {
    const relative = new URL(route.request().url()).pathname.split(
      "/test-extension/",
    )[1];
    const file = path.resolve("extension", relative);
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".png": "image/png",
    };
    await route.fulfill({
      body: await fs.readFile(file),
      contentType: types[path.extname(file)],
    });
  });
  await page.addInitScript(
    ({ initial, text, version }: any) => {
      if (!localStorage.getItem("popup-test-initialized")) {
        localStorage.setItem("popup-test-initialized", "yes");
        localStorage.setItem("popup-test-connection", JSON.stringify(initial));
      }
      (window as any).chrome = {
        runtime: { getManifest: () => ({ version }) },
        storage: {
          local: {
            get: async () =>
              JSON.parse(localStorage.getItem("popup-test-connection") || "{}"),
            set: async (value: any) =>
              localStorage.setItem(
                "popup-test-connection",
                JSON.stringify(value),
              ),
          },
        },
        permissions: { request: async () => true },
        tabs: { query: async () => [{ id: 7 }] },
        scripting: {
          executeScript: async () => [
            {
              result: {
                title: "多智能体的产品实践",
                url: "https://reader.example/article",
                text,
              },
            },
          ],
        },
      };
    },
    {
      initial: connected ? { service, token: "valid-popup-token" } : {},
      text,
      version,
    },
  );
  await page.route("**/api/integrations/connection*", (route: any) => {
    const valid =
      route.request().headers().authorization === "Bearer valid-popup-token";
    return route.fulfill({
      status: valid ? 200 : 401,
      json: valid ? { ok: true } : { error: "无效凭证" },
    });
  });
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/test-extension/popup.html");
}
async function connect(page: any) {
  await page.getByLabel("服务地址").fill(service);
  await page.getByLabel("接收凭证").fill("valid-popup-token");
  await page.getByRole("button", { name: "连接并继续", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "提取当前页面", exact: true }),
  ).toBeVisible();
}
test("首次打开先连接，验证失败不保存，成功后重开不再显示引导", async ({
  page,
}) => {
  await popup(page);
  await expect(
    page.getByRole("heading", { name: "连接 Fenext", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "提取当前页面", exact: true }),
  ).toBeHidden();
  await page.getByLabel("服务地址").fill(service);
  await fs.mkdir(".local/qa", { recursive: true });
  await page.screenshot({ path: ".local/qa/plugin-first-connection.png" });
  await page.getByLabel("接收凭证").fill("incorrect-token");
  await page.getByRole("button", { name: "连接并继续", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("接收凭证无效或已过期");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("popup-test-connection") || "{}"),
    ),
  ).toEqual({});
  await connect(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "收集当前文章", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#connection-intro")).toBeHidden();
  await page.getByRole("button", { name: "连接设置", exact: true }).click();
  await expect(page.getByLabel("服务地址")).toHaveValue(service);
  await expect(page.locator("#connection-intro")).toBeHidden();
  await page.getByRole("button", { name: "返回收集", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "提取当前页面", exact: true }),
  ).toBeVisible();
});
test("提取后隐藏提示与按钮，问题前置且可一屏保存；失效后重连保留正文", async ({
  page,
}) => {
  await popup(page, true);
  let expired = true;
  let submitted: any;
  await page.route("**/api/tasks", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({
      status: expired ? 401 : 201,
      json: expired ? { error: "已过期" } : { id: "saved-article" },
    });
  });
  await page.getByRole("button", { name: "提取当前页面", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "核对并保存", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#extract")).toBeHidden();
  await expect(page.getByLabel("实际提取文字", { exact: true })).toBeHidden();
  await expect(page.getByLabel("想了解什么？")).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "保存并整理", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(600);
  await page.getByLabel("想了解什么？").fill("多智能体协作有哪些适用边界？");
  await page.screenshot({ path: ".local/qa/plugin-extracted-preview.png" });
  await page.locator("#extracted-text summary").click();
  await expect(page.getByLabel("实际提取文字", { exact: true })).toHaveValue(
    text,
  );
  await page.getByRole("button", { name: "保存并整理", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已提取的内容会保留");
  await page.getByLabel("服务地址").fill(service);
  await page.getByLabel("接收凭证").fill("valid-popup-token");
  await page.getByRole("button", { name: "连接并继续", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "核对并保存", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("想了解什么？")).toHaveValue(
    "多智能体协作有哪些适用边界？",
  );
  await expect(page.getByLabel("实际提取文字", { exact: true })).toHaveValue(
    text,
  );
  expired = false;
  await page.getByRole("button", { name: "保存并整理", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "已保存到 Fenext 收集箱",
  );
  expect(submitted.question).toBe("多智能体协作有哪些适用边界？");
  expect(submitted.text).toBe(text);
  expect(submitted.urlMode).toBe("reference");
  await expect(
    page.getByRole("button", { name: "提取当前页面", exact: true }),
  ).toBeVisible();
});

test("打开旧版自动发现更新，可下载真实安装包且不丢失已提取内容", async ({
  page,
}) => {
  await popup(page, true, "0.1.3");
  await expect(
    page.getByRole("complementary", { name: "插件更新" }),
  ).toBeVisible();
  await expect(page.locator("#update-title")).toHaveText(
    `有新版本 ${manifest.version}`,
  );
  await expect(page.locator("#installed-version")).toHaveText("版本 0.1.3");
  await page.getByRole("button", { name: "提取当前页面", exact: true }).click();
  await page.getByLabel("想了解什么？").fill("更新插件前保留我的问题");
  await expect(
    page.getByRole("button", { name: "保存并整理", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(600);
  await page.screenshot({ path: ".local/qa/plugin-update-banner.png" });
  await page.getByText("更新说明与步骤", { exact: true }).click();
  await expect(page.locator("#update-banner")).toContainText("连接设置会保留");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载新版", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(
    `Fenext-Browser-${manifest.version}.zip`,
  );
  expect(await download.failure()).toBeNull();
  expect(await fs.readFile((await download.path())!)).toEqual(
    await fs.readFile(`release/Fenext-Browser-${manifest.version}.zip`),
  );
  await expect(page.getByLabel("想了解什么？")).toHaveValue(
    "更新插件前保留我的问题",
  );
  await expect(page.getByLabel("实际提取文字", { exact: true })).toHaveValue(
    text,
  );
});
test("更新检查失败保持收集可用，手动重试能确认当前版本", async ({ page }) => {
  await page.route("**/api/integrations/extension/latest", (route) =>
    route.abort(),
  );
  await popup(page, true);
  await expect(
    page.getByRole("button", { name: "检查更新", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#update-banner")).toBeHidden();
  await expect(page.locator("#update-status")).toBeEmpty();
  await page.getByRole("button", { name: "提取当前页面", exact: true }).click();
  await page.getByLabel("想了解什么？").fill("版本检查不影响这个问题");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.locator("#update-status")).toContainText("不影响使用");
  await expect(
    page.getByRole("button", { name: "保存并整理", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/api/integrations/extension/latest");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.locator("#update-status")).toHaveText("当前已是最新版本。");
  await expect(page.locator("#update-banner")).toBeHidden();
  await expect(page.getByLabel("想了解什么？")).toHaveValue(
    "版本检查不影响这个问题",
  );
});
