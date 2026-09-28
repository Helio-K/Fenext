const { api, authed, stages, fail } = require("../../lib/api");
Page({
  data: { tasks: [], loading: true, error: "", q: "" },
  onShow() {
    if (authed()) {
      this.load();
      this.timer = setInterval(() => this.load(), 5000);
    }
  },
  onHide() {
    clearInterval(this.timer);
  },
  onUnload() {
    clearInterval(this.timer);
  },
  async load() {
    try {
      const tasks = (await api("/tasks")).map((t) => ({
        ...t,
        status: stages[t.stage],
        summary: t.result
          ? `新增 ${t.result.new.length} · 已有 ${t.result.existing.length} · 更新待查看 ${t.result.pendingUpdates ?? t.result.updates.length}`
          : "云端已接收",
      }));
      this.all = tasks;
      this.setData({
        tasks: tasks.filter((t) => t.title.includes(this.data.q)),
        loading: false,
        error: "",
      });
    } catch (e) {
      fail(this, e);
    }
  },
  search(e) {
    this.setData({
      q: e.detail.value,
      tasks: (this.all || []).filter((t) => t.title.includes(e.detail.value)),
    });
  },
  collect() {
    wx.navigateTo({ url: "/pages/collect/index" });
  },
  open(e) {
    wx.navigateTo({
      url: "/pages/task/index?id=" + e.currentTarget.dataset.id,
    });
  },
});
