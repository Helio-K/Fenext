const { api, stages, fail } = require("../../lib/api");
Page({
  data: { task: null, error: "", busy: false },
  onLoad(o) {
    this.id = o.id;
  },
  onShow() {
    this.load();
    this.timer = setInterval(() => this.load(), 4000);
  },
  onHide() {
    clearInterval(this.timer);
  },
  onUnload() {
    clearInterval(this.timer);
  },
  async load() {
    try {
      const t = await api("/tasks/" + this.id);
      this.setData({
        task: {
          ...t,
          status:
            t.stage === "failed" && t.checkpoint?.sourceIssue
              ? "未读到正文"
              : stages[t.stage],
        },
        error: "",
      });
    } catch (e) {
      fail(this, e);
    }
  },
  open(e) {
    wx.navigateTo({
      url:
        "/pages/" +
        (e.currentTarget.dataset.kind === "update" ? "review" : "note") +
        "/index?id=" +
        e.currentTarget.dataset.id,
    });
  },
  async action(e) {
    this.setData({ busy: true });
    try {
      await api("/tasks/" + this.id + "/" + e.currentTarget.dataset.action, {});
      this.setData({ busy: false });
      this.load();
    } catch (e) {
      fail(this, e);
    }
  },
  settings() {
    wx.switchTab({ url: "/pages/settings/index" });
  },
  remove() {
    wx.showModal({
      title: "删除任务",
      content: "从收集箱移除并停止后续处理。已生成的知识笔记和来源依据会保留。",
      confirmText: "删除任务",
      success: async (result) => {
        if (!result.confirm || this.data.busy) return;
        this.setData({ busy: true });
        try {
          await api("/tasks/" + this.id, {}, "DELETE");
          clearInterval(this.timer);
          wx.switchTab({ url: "/pages/inbox/index" });
        } catch (e) {
          fail(this, e);
        }
      },
    });
  },
  collect() {
    if (this.data.task?.input?.url) {
      wx.setStorageSync("fenext-collect-prefill", {
        url: this.data.task.input.url,
        title: this.data.task.title,
        key: this.id,
      });
      wx.navigateTo({ url: "/pages/collect/index?source=1" });
    } else wx.navigateTo({ url: "/pages/collect/index" });
  },
});
