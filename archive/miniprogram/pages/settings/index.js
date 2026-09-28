const { api, authed, fail } = require("../../lib/api");
Page({
  data: {
    settings: null,
    endpoint: "https://api.openai.com/v1",
    model: "",
    key: "",
    busy: false,
    error: "",
    notice: "",
    sources: false,
  },
  onShow() {
    if (authed()) this.load();
  },
  async load() {
    try {
      const s = await api("/settings");
      this.setData({
        settings: s,
        endpoint: s.ai?.endpoint || this.data.endpoint,
        model: s.ai?.model || "",
        error: "",
      });
    } catch (e) {
      fail(this, e);
    }
  },
  input(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async save() {
    this.setData({ busy: true, error: "" });
    try {
      await api("/settings/ai", {
        endpoint: this.data.endpoint,
        model: this.data.model,
        ...(this.data.key ? { key: this.data.key } : {}),
      });
      this.setData({
        key: "",
        busy: false,
        notice: "校验通过，等待配置的任务已恢复",
      });
      this.load();
    } catch (e) {
      fail(this, e);
    }
  },
  sources() {
    this.setData({ sources: !this.data.sources });
  },
  async logout() {
    try {
      await api("/logout", {});
    } finally {
      wx.removeStorageSync("fenext-token");
      wx.removeStorageSync("fenext-user");
      wx.navigateTo({ url: "/pages/login/index" });
    }
  },
});
