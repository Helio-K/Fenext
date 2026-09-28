function captureArticle() {
  const url = location.href;
  if (!/^https?:$/.test(location.protocol))
    return { error: "请先打开一篇网页文章" };
  if (
    location.hostname === "mp.weixin.qq.com" &&
    /\/wappoc_appmsgcaptcha/.test(location.pathname)
  )
    return { error: "当前是微信验证页。请完成验证并打开文章，再点击收集。" };
  const article = document.querySelector(
    "#js_content, article, [itemprop='articleBody'], main",
  );
  const node = article || document.body;
  if (!node) return { error: "页面尚未加载，请稍后重试" };
  const clone = node.cloneNode(true);
  clone
    .querySelectorAll(
      "script, style, nav, footer, header, form, button, aside, noscript, [aria-hidden='true']",
    )
    .forEach((n) => n.remove());
  const text = (clone.innerText || node.innerText || clone.textContent || "")
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
  if (
    /环境异常.{0,50}完成验证后|请完成安全验证|访问过于频繁/.test(
      text.slice(0, 500),
    ) &&
    text.length < 1000
  )
    return {
      error: "当前页面显示验证或访问限制，未取得文章正文。请完成验证后重试。",
    };
  if (text.length < 80)
    return {
      error: "当前页面可见正文不足 80 字。请确认文章已打开并加载完成。",
    };
  const title = (
    document.querySelector("#activity-name")?.textContent ||
    document.title ||
    url
  ).trim();
  return {
    url,
    title: title.slice(0, 200),
    text: text.slice(0, 60000),
    truncated: text.length > 60000,
  };
}
if (typeof module !== "undefined") module.exports = { captureArticle };
