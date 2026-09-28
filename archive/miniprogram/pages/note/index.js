const { api, fail } = require("../../lib/api");
Page({
  data: {
    note: null,
    panel: "body",
    messages: [],
    history: [],
    text: "",
    mode: "discuss",
    busy: false,
    error: "",
    term: "",
    pron: null,
  },
  onLoad(o) {
    this.id = o.id;
  },
  onShow() {
    this.load();
  },
  onUnload() {
    this.audio?.destroy();
  },
  async load() {
    try {
      const note = await api("/notes/" + this.id);
      this.setData({
        note,
        error: "",
        terms: [
          ...new Set(
            [...note.body.matchAll(/\[\[([^\]]+)\]\]/g)].map(
              (m) => m[1].split("|")[0],
            ),
          ),
        ],
        pending: note.suggestions.filter((s) => s.status === "pending"),
      });
    } catch (e) {
      fail(this, e);
    }
  },
  async panel(e) {
    const panel = e.currentTarget.dataset.panel;
    this.setData({ panel });
    try {
      if (panel === "chat")
        this.setData({ messages: await api("/notes/" + this.id + "/chat") });
      if (panel === "history")
        this.setData({ history: await api("/notes/" + this.id + "/history") });
    } catch (e) {
      fail(this, e);
    }
  },
  input(e) {
    this.setData({
      text: e.detail.value,
      mode: /^(把|请把|将|修改|改写|补充|删除)/.test(e.detail.value)
        ? "edit"
        : this.data.mode,
    });
  },
  mode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },
  async send() {
    this.setData({ busy: true, error: "" });
    try {
      await api("/notes/" + this.id + "/chat", {
        text: this.data.text,
        mode: this.data.mode,
      });
      this.setData({
        text: "",
        busy: false,
        messages: await api("/notes/" + this.id + "/chat"),
      });
      this.load();
    } catch (e) {
      fail(this, e);
      this.setData({ messages: await api("/notes/" + this.id + "/chat") });
    }
  },
  review(e) {
    wx.navigateTo({
      url: "/pages/review/index?id=" + e.currentTarget.dataset.id,
    });
  },
  restore(e) {
    const version = e.currentTarget.dataset.version;
    wx.showModal({
      title: "恢复为新版本",
      content: "当前与中间版本仍会保留。",
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api("/notes/" + this.id + "/restore", {
            version,
            baseVersion: this.data.note.version,
          });
          this.load();
          this.setData({
            history: await api("/notes/" + this.id + "/history"),
          });
        } catch (err) {
          fail(this, err);
        }
      },
    });
  },
  async term(e) {
    const term = e.currentTarget.dataset.term;
    this.setData({ term, pron: null });
    try {
      this.setData({
        related: await api("/notes?q=" + encodeURIComponent(term)),
      });
    } catch (err) {
      fail(this, err);
    }
  },
  async pronounce() {
    try {
      const pron = await api(
        "/pronunciation?term=" +
          encodeURIComponent(this.data.term || this.data.note.title),
      );
      this.setData({ pron });
      if (pron.audio) {
        this.audio?.destroy();
        this.audio = wx.createInnerAudioContext();
        this.audio.src = pron.audio;
        this.audio.onError(() =>
          this.setData({ error: "发音播放失败，仍可阅读" }),
        );
        this.audio.play();
      }
    } catch (e) {
      fail(this, e);
    }
  },
  related(e) {
    wx.navigateTo({
      url: "/pages/note/index?id=" + e.currentTarget.dataset.id,
    });
  },
  supplement() {
    wx.showModal({
      title: "补充资料",
      editable: true,
      placeholderText: "输入要补充的问题",
      success: async (r) => {
        if (!r.confirm || !r.content) return;
        try {
          const t = await api(
            "/supplement",
            { noteId: this.id, query: r.content },
            "POST",
            { "Idempotency-Key": require("../../lib/api").key() },
          );
          wx.navigateTo({ url: "/pages/task/index?id=" + t.id });
        } catch (e) {
          fail(this, e);
        }
      },
    });
  },
});
