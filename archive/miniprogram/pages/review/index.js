const { api, fail } = require("../../lib/api");
Page({
  data: { suggestion: null, selected: [], error: "", busy: false },
  onLoad(o) {
    this.id = o.id;
    this.load();
  },
  async load() {
    try {
      const s = await api("/suggestions/" + this.id);
      this.setData({
        suggestion: s,
        selected: s.items
          .filter((i) => i.status === "pending")
          .map((i) => i.id),
        error: "",
      });
    } catch (e) {
      fail(this, e);
    }
  },
  select(e) {
    this.setData({ selected: e.detail.value });
  },
  edit(e) {
    const i = e.currentTarget.dataset.index;
    this.setData({ ["suggestion.items[" + i + "].after"]: e.detail.value });
  },
  async accept() {
    this.setData({ busy: true });
    try {
      const edited = Object.fromEntries(
        this.data.suggestion.items.map((i) => [i.id, i.after]),
      );
      await api("/suggestions/" + this.id + "/accept", {
        items: this.data.selected,
        edited,
      });
      wx.redirectTo({
        url: "/pages/note/index?id=" + this.data.suggestion.note_id,
      });
    } catch (e) {
      fail(this, e);
    }
  },
  async reject() {
    try {
      await api("/suggestions/" + this.id + "/reject", {});
      wx.navigateBack();
    } catch (e) {
      fail(this, e);
    }
  },
  async recompare() {
    this.setData({ busy: true });
    try {
      const r = await api("/suggestions/" + this.id + "/recompare", {});
      wx.redirectTo({
        url: r.id
          ? "/pages/review/index?id=" + r.id
          : "/pages/note/index?id=" + r.noteId,
      });
    } catch (e) {
      fail(this, e);
    }
  },
});
