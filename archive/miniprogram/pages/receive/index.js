const { api, authed, key, fail } = require("../../lib/api");
const { normalizeEntry } = require("../../lib/materials");
const pendingKey = "fenext-pending-source";
function readFile(path, encoding) {
  return new Promise((resolve, reject) =>
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding,
      success: (result) => resolve(result.data),
      fail: () =>
        reject(new Error("导入素材已失效，请从微信重新选择文章或图片")),
    }),
  );
}
Page({
  data: { source: null, unsupported: [], error: "", busy: false, note: "" },
  onLoad(query) {
    const launch = wx.getEnterOptionsSync ? wx.getEnterOptionsSync() : {};
    const entry = normalizeEntry(query, launch);
    const hasInput =
      entry.source.url ||
      entry.source.files.length ||
      entry.source.textFiles.length;
    if (hasInput) {
      this.pending = { ...entry, key: key() };
      wx.setStorageSync(pendingKey, this.pending);
    } else if (entry.received) {
      this.pending = null;
      wx.removeStorageSync(pendingKey);
    } else this.pending = wx.getStorageSync(pendingKey) || null;
    this.setData({
      source: this.pending?.source || null,
      unsupported: this.pending?.unsupported || entry.unsupported,
      note: this.pending?.received
        ? "已收到微信转入的素材。保存前请检查来源；只有链接时仍需读取正文。"
        : "已取得链接；保存后将尝试读取网页正文。",
    });
  },
  async submit() {
    if (this.data.busy || !this.pending) return;
    if (!authed()) return;
    this.setData({ busy: true, error: "" });
    try {
      const source = this.pending.source;
      const texts = await Promise.all(
        source.textFiles.map(async (file) => {
          const content = await readFile(file.path, "utf8");
          if (content.length > 2 * 1024 * 1024)
            throw new Error("文字素材过大，请手动摘录正文");
          const text = file.html
            ? content
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
                .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
            : content;
          if (
            /环境异常.{0,50}完成验证后|请完成安全验证/.test(
              text.slice(0, 500),
            ) &&
            text.length < 1000
          )
            throw new Error(
              "微信转入的是验证页，未取得正文。请完成验证后重试，或手动补充正文。",
            );
          return text;
        }),
      );
      const text = texts.join("\n\n").slice(0, 60000);
      const images = await Promise.all(
        source.files.map(async (file) => ({
          name: file.name,
          data:
            "data:" +
            file.type +
            ";base64," +
            (await readFile(file.path, "base64")),
        })),
      );
      const t = await api(
        "/tasks",
        {
          title: source.title || undefined,
          url: source.url,
          text,
          images,
          urlMode: source.url && (text || images.length) ? "reference" : "read",
          app: "微信小程序转入",
        },
        "POST",
        { "Idempotency-Key": this.pending.key },
      );
      wx.removeStorageSync(pendingKey);
      wx.redirectTo({ url: "/pages/task/index?id=" + t.id });
    } catch (e) {
      fail(this, e);
    }
  },
  manual() {
    if (this.pending?.source?.url) {
      wx.setStorageSync("fenext-collect-prefill", {
        url: this.pending.source.url,
        title: this.pending.source.title,
        key: this.pending.key,
      });
      wx.navigateTo({ url: "/pages/collect/index?source=1" });
    } else wx.navigateTo({ url: "/pages/collect/index" });
  },
});
