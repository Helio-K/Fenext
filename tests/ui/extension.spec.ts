import { test, expect } from "@playwright/test";
import path from "node:path";

test("浏览器提取当前文章正文，验证页保持错误而不保存", async ({ page }) => {
  await page.route("https://reader.example/article", (route) =>
    route.fulfill({
      contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><title>文章标题</title><main><h1>文章标题</h1><p>${"多智能体任务需要明确分工、共享状态与结果核验。".repeat(8)}</p><nav>无关导航</nav></main>`,
    }),
  );
  await page.goto("https://reader.example/article");
  await page.addScriptTag({ path: path.resolve("extension/capture.js") });
  const article = await page.evaluate(() => (window as any).captureArticle());
  expect(article.title).toBe("文章标题");
  expect(article.url).toBe("https://reader.example/article");
  expect(article.text).toContain("共享状态");
  expect(article.text).not.toContain("无关导航");
  await page.route(
    "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha",
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<body>环境异常，完成验证后即可继续访问</body>",
      }),
  );
  await page.goto("https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha");
  await page.addScriptTag({ path: path.resolve("extension/capture.js") });
  expect(
    (await page.evaluate(() => (window as any).captureArticle())).error,
  ).toContain("验证页");
});
