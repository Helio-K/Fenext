const { api, authed, fail } = require("../../lib/api");
Page({
  data: { notes: [], q: "", mode: "concepts", error: "", loading: true },
  onShow() {
    if (authed()) this.load();
  },
  onUnload() {
    clearTimeout(this.timer);
  },
  async load() {
    try {
      const notes = await api(
        "/notes?q=" +
          encodeURIComponent(this.data.q) +
          "&mode=" +
          this.data.mode,
      );
      this.setData({ notes, error: "", loading: false });
    } catch (e) {
      fail(this, e);
    }
  },
  search(e) {
    this.setData({ q: e.detail.value });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  },
  mode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
    this.load();
  },
  open(e) {
    wx.navigateTo({
      url: "/pages/note/index?id=" + e.currentTarget.dataset.id,
    });
  },
});
