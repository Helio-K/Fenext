import * as cheerio from "cheerio";
import { publicFetch } from "./security.mjs";
import {
  isWechatChallengeURL,
  sourceBlockedMessage,
} from "./source-access.mjs";
export function readWebPage(html, url) {
  const $ = cheerio.load(html);
  $("script,style,nav,footer,header,noscript,form").remove();
  const wechat = new URL(url).hostname === "mp.weixin.qq.com";
  const article = $(wechat ? "#js_content" : "article")
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const body = $("body").text().replace(/\s+/g, " ").trim();
  if (
    isWechatChallengeURL(url) ||
    (wechat &&
      !article &&
      /环境异常|完成验证后|访问过于频繁|访问过于频密|操作频繁|该内容已被发布者删除|此内容因违规无法查看/.test(
        body,
      ))
  ) {
    throw Object.assign(new Error(sourceBlockedMessage), {
      code: "SOURCE_BLOCKED",
      url,
    });
  }
  const content =
    article || $("main").text().replace(/\s+/g, " ").trim() || body;
  if (content.length < 50)
    throw new Error("页面可读取内容不足，可能需要登录或动态加载；请粘贴正文");
  return {
    kind: "web",
    url,
    title:
      (wechat ? $("#activity-name").text().trim() : "") ||
      $("title").text().trim(),
    range:
      content.length > 60000
        ? "部分正文：前 60000 字符"
        : wechat && article
          ? "公众号正文区域可提取文字（不包含图片内容，不保证完整正文）"
          : "页面可提取文字（不保证完整正文）",
    content: content.slice(0, 60000),
  };
}
export async function readMaterial(input, { fetcher = publicFetch } = {}) {
  const result = [];
  const reference = input.urlMode === "reference";
  const source = reference && input.url ? { url: input.url } : {};
  if (reference && !input.text?.trim() && !input.images?.length)
    throw new Error("链接仅作为来源记录时，请粘贴正文或添加图片");
  if (input.text)
    result.push({
      kind: "text",
      ...source,
      range: reference
        ? "用户提交文字；链接仅作为来源记录，未读取链接正文"
        : "用户提交文字",
      content: input.text,
    });
  if (input.url && !reference) {
    const r = await fetcher(input.url);
    if (
      r.type.includes("pdf") ||
      r.bytes.subarray(0, 4).toString() === "%PDF"
    ) {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdf = await getDocument({
        data: new Uint8Array(r.bytes),
        isEvalSupported: false,
        useSystemFonts: true,
      }).promise;
      try {
        const pages = [];
        for (let n = 1; n <= Math.min(pdf.numPages, 30); n++) {
          const p = await pdf.getPage(n);
          const text = (await p.getTextContent()).items
            .map((i) => i.str || "")
            .join(" ");
          pages.push({ page: n, text });
        }
        const content = pages
          .map((p) => `[第 ${p.page} 页]\n${p.text}`)
          .join("\n");
        if (content.trim().length < 30)
          throw new Error("PDF 缺少可提取文字，请补充正文或页面图片");
        result.push({
          kind: "pdf",
          url: r.url,
          range: `第 1–${pages.length} 页 / 共 ${pdf.numPages} 页；最多 60000 字符`,
          content: content.slice(0, 60000),
        });
      } finally {
        await pdf.destroy();
      }
    } else if (r.type.includes("html")) {
      result.push(readWebPage(r.bytes.toString("utf8"), r.url));
    } else if (r.type.startsWith("text/"))
      result.push({
        kind: "text",
        url: r.url,
        range: "最多前 60000 字符",
        content: r.bytes.toString("utf8").slice(0, 60000),
      });
    else throw new Error("当前链接类型不支持，请提交网页、PDF、正文或图片");
  }
  if (input.images.length)
    result.push({
      kind: "image",
      ...source,
      range:
        "用户提交图片，由所选多模态模型识别" +
        (reference ? "；链接仅作为来源记录，未读取链接正文" : ""),
      content: input.images.map((i) => i.name).join("、"),
    });
  return result;
}
