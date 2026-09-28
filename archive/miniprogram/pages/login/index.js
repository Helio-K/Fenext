const { api, fail } = require("../../lib/api");
Page({
  data: { username: "", password: "", busy: false, error: "" },
  input(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async submit() {
    this.setData({ busy: true, error: "" });
    try {
      const r = await api("/login", {
        username: this.data.username,
        password: this.data.password,
        client: "mini",
      });
      wx.setStorageSync("fenext-token", r.token);
      wx.setStorageSync("fenext-user", r.user.id);
      this.setData({ busy: false });
      if (getCurrentPages().length > 1) wx.navigateBack();
      else wx.switchTab({ url: "/pages/inbox/index" });
    } catch (e) {
      fail(this, e);
    }
  },
});
