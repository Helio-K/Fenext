const { api, key, fail } = require("../../lib/api");
Page({
  data: {
    text: "",
    url: "",
    urlMode: "read",
    question: "",
    images: [],
    busy: false,
    error: "",
    saved: "",
  },
  onLoad(options) {
    const prefill =
      options?.source === "1"
        ? wx.getStorageSync("fenext-collect-prefill")
        : null;
    this.prefill = prefill || null;
    this.storage =
      "fenext-draft:" +
      wx.getStorageSync("fenext-user") +
      (prefill?.key ? ":source:" + prefill.key : "");
    const d = wx.getStorageSync(this.storage);
    if (d) this.setData(d);
    else if (prefill?.url)
      this.setData({ url: prefill.url, urlMode: "reference" });
    this.requestKey = key();
  },
  input(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
    this.save();
  },
  reference(e) {
    this.setData({ urlMode: e.detail.value ? "reference" : "read" });
    this.save();
  },
  save() {
    try {
      wx.setStorageSync(this.storage, {
        text: this.data.text,
        url: this.data.url,
        urlMode: this.data.urlMode,
        question: this.data.question,
        images: this.data.images,
      });
      this.setData({ saved: "本地草稿已保存" });
      this.requestKey = key();
    } catch {
      this.setData({ saved: "本地草稿保存失败，请保持页面打开" });
    }
  },
  addImage() {
    wx.chooseMedia({
      count: 4 - this.data.images.length,
      mediaType: ["image"],
      success: async (r) => {
        try {
          const files = await Promise.all(
            r.tempFiles.map(
              (f) =>
                new Promise((resolve, reject) => {
                  if (f.size > 2 * 1024 * 1024)
                    return reject(new Error("每张图片不超过 2 MB"));
                  const ext = f.tempFilePath.split(".").pop().toLowerCase();
                  const mime = {
                    png: "png",
                    jpg: "jpeg",
                    jpeg: "jpeg",
                    webp: "webp",
                  }[ext];
                  if (!mime)
                    return reject(new Error("请使用 PNG、JPEG 或 WebP 图片"));
                  wx.getFileSystemManager().readFile({
                    filePath: f.tempFilePath,
                    encoding: "base64",
                    success: (d) =>
                      resolve({
                        name: "图片." + ext,
                        data: "data:image/" + mime + ";base64," + d.data,
                      }),
                    fail: () => reject(new Error("图片读取失败")),
                  });
                }),
            ),
          );
          this.setData({ images: [...this.data.images, ...files] });
          this.save();
        } catch (e) {
          fail(this, e);
        }
      },
    });
  },
  remove(e) {
    this.setData({
      images: this.data.images.filter(
        (_, i) => i !== e.currentTarget.dataset.index,
      ),
    });
    this.save();
  },
  async submit() {
    this.setData({ busy: true, error: "" });
    try {
      const t = await api(
        "/tasks",
        {
          text: this.data.text,
          url: this.data.url,
          urlMode: this.data.urlMode,
          title: this.prefill?.title || undefined,
          question: this.data.question,
          images: this.data.images,
          app: "微信小程序",
        },
        "POST",
        { "Idempotency-Key": this.requestKey },
      );
      wx.removeStorageSync(this.storage);
      if (this.prefill) wx.removeStorageSync("fenext-collect-prefill");
      wx.redirectTo({ url: "/pages/task/index?id=" + t.id });
    } catch (e) {
      fail(this, e);
    }
  },
});
