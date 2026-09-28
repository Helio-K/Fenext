const { apiBase } = require("../config");
function api(path, body, method, headers) {
  return new Promise((resolve, reject) =>
    wx.request({
      url: apiBase + "/api" + path,
      method: method || (body === undefined ? "GET" : "POST"),
      data: body,
      header: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (wx.getStorageSync("fenext-token") || ""),
        ...headers,
      },
      success: (r) => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(r.data);
        else {
          if (r.statusCode === 401) {
            wx.removeStorageSync("fenext-token");
            const pages = getCurrentPages();
            const page = pages[pages.length - 1];
            if (page?.route !== "pages/login/index")
              wx.navigateTo({ url: "/pages/login/index" });
          }
          reject(new Error(r.data.error || "请求失败"));
        }
      },
      fail: () => reject(new Error("无法连接服务，请检查网络与服务地址")),
    }),
  );
}
const key = () =>
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
function authed() {
  if (!wx.getStorageSync("fenext-token")) {
    wx.navigateTo({ url: "/pages/login/index" });
    return false;
  }
  return true;
}
const stages = {
  waiting_config: "等待 AI 配置",
  queued: "排队中",
  reading: "读取资料",
  extracting: "提炼知识",
  comparing: "对照已有知识",
  completed: "已完成",
  failed: "处理失败",
  cancelled: "已取消",
};
function fail(page, e) {
  page.setData({ error: e.message, busy: false, loading: false });
}
module.exports = { api, key, authed, stages, fail };
