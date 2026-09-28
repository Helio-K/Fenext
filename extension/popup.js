const $ = (id) => document.getElementById(id);
let capture = null;
let connected = false;
let connectionCheckId = 0;
function connectionRequest(service, token) {
  const browser = /Edg\//.test(navigator.userAgent) ? "edge" : "chrome";
  return fetch(
    `${service}/api/integrations/connection?browser=${browser}&version=${encodeURIComponent(installedVersion)}`,
    {
      headers: { Authorization: "Bearer " + token },
      credentials: "omit",
      signal: AbortSignal.timeout(4000),
    },
  );
}
async function confirmSavedConnection(service, token) {
  const checkId = ++connectionCheckId;
  try {
    const response = await connectionRequest(service, token);
    if (checkId !== connectionCheckId) return;
    if (response.status === 401 || response.status === 403) {
      connected = false;
      showConnection();
      message("接收凭证无效或已过期，请在 Fenext 中重新生成并连接。");
    }
  } catch {
    // Temporary network failures must not prevent extracting an article.
  }
}

const installedVersion = chrome.runtime.getManifest().version;
$("installed-version").textContent = `版本 ${installedVersion}`;
let currentService = "",
  updateCheckId = 0;
async function checkUpdates(manual = false) {
  const checkId = ++updateCheckId;
  if (!currentService) {
    if (manual)
      $("update-status").textContent = "请先连接 Fenext，再检查更新。";
    return;
  }
  $("check-update").disabled = true;
  if (manual) $("update-status").textContent = "正在检查…";
  try {
    const response = await fetch(
      currentService + "/api/integrations/extension/latest",
      {
        signal: AbortSignal.timeout(4000),
        credentials: "omit",
      },
    );
    if (!response.ok) throw new Error("检查失败");
    const release = await response.json();
    if (checkId !== updateCheckId) return;
    if (
      typeof release.version !== "string" ||
      !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(release.version) ||
      release.version.split(".").some((n) => Number(n) > 65535)
    )
      throw new Error("版本信息不正确");
    const newer = FenextUpdate.isNewerVersion(
      release.version,
      installedVersion,
    );
    $("update-banner").hidden = !newer;
    if (newer) {
      $("update-title").textContent = `有新版本 ${release.version}`;
      $("update-download").href =
        `${currentService}/api/integrations/extension/download?version=${encodeURIComponent(release.version)}`;
      $("update-changes").replaceChildren();
      for (const change of (Array.isArray(release.changes)
        ? release.changes
        : []
      ).slice(0, 3)) {
        if (typeof change !== "string") continue;
        const item = document.createElement("li");
        item.textContent = change.slice(0, 200);
        $("update-changes").append(item);
      }
    }
    $("update-status").textContent = manual
      ? newer
        ? "发现新版本，更新前仍可继续使用。"
        : "当前已是最新版本。"
      : "";
  } catch {
    if (manual && checkId === updateCheckId)
      $("update-status").textContent =
        "暂时无法检查更新，不影响使用，请稍后再试。";
  } finally {
    if (checkId === updateCheckId) $("check-update").disabled = false;
  }
}
$("check-update").addEventListener("click", () => void checkUpdates(true));

function showCollector() {
  $("connection").hidden = true;
  $("collector").hidden = false;
  $("connection-settings").hidden = false;
  $("heading").textContent = capture ? "核对并保存" : "收集当前文章";
  $("extract").hidden = !!capture;
  $("preview").hidden = !capture;
}
function showConnection() {
  $("collector").hidden = true;
  $("connection").hidden = false;
  $("connection-settings").hidden = true;
  $("connection-intro").hidden = connected;
  $("cancel-connection").hidden = !connected;
  $("heading").textContent = connected ? "连接设置" : "连接 Fenext";
  $("settings-save").textContent = connected ? "保存连接" : "连接并继续";
}
$("connection-settings").addEventListener("click", () => {
  message("");
  showConnection();
});
$("cancel-connection").addEventListener("click", () => {
  message("");
  showCollector();
});
function message(value, ok = false) {
  $("message").textContent = value;
  $("message").className = ok ? "ok" : "";
}
function serviceURL(value) {
  const url = new URL(value.trim());
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    )
  )
    throw new Error("服务地址须为本机 HTTP 或 HTTPS 站点根地址");
  return url.origin;
}
async function storeConnection() {
  const service = serviceURL($("service").value);
  const token = $("token").value.trim();
  if (!token) throw new Error("请填写 Fenext 接收凭证");
  if (service.startsWith("https:")) {
    const granted = await chrome.permissions.request({
      origins: [service + "/*"],
    });
    if (!granted) throw new Error("未获得此服务地址的连接权限");
  }
  ++connectionCheckId;
  const response = await connectionRequest(service, token);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(
      response.status === 401 || response.status === 403
        ? "接收凭证无效或已过期，请在 Fenext 中重新生成。"
        : data.error || "暂时无法连接 Fenext，请稍后重试。",
    );
  }
  await chrome.storage.local.set({ service, token });
  connected = true;
  currentService = service;
  $("update-banner").hidden = true;
  $("update-status").textContent = "";
  void checkUpdates();
  showCollector();
  message("已连接，可以开始收集。", true);
  return { service, token };
}
$("connection-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if ($("settings-save").disabled) return;
  $("settings-save").disabled = true;
  $("settings-save").textContent = "正在连接…";
  try {
    await storeConnection();
  } catch (e) {
    message(
      e instanceof TypeError
        ? "无法连接 Fenext，请检查服务地址并确认服务已启动。"
        : e.message,
    );
  } finally {
    $("settings-save").disabled = false;
    $("settings-save").textContent = connected ? "保存连接" : "连接并继续";
  }
});
$("capture").addEventListener("click", async () => {
  $("capture").disabled = true;
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error("没有找到当前浏览器标签页");
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureArticle,
    });
    if (!result?.result || result.result.error)
      throw new Error(result?.result?.error || "未能提取当前页面");
    capture = result.result;
    $("title").value = capture.title;
    $("source").value = capture.url;
    $("content").value = capture.text;
    $("extracted-text").open = false;
    $("text-count").textContent = `${capture.text.length} 字`;
    showCollector();
    message(
      `已提取 ${capture.text.length} 字${capture.truncated ? "（仅保存前 60000 字）" : ""}，请核对后保存。`,
      true,
    );
  } catch (e) {
    message(e.message);
  } finally {
    $("capture").disabled = false;
  }
});
$("save").addEventListener("click", async () => {
  if (!capture) return message("请先提取当前页面");
  const text = $("content").value.trim();
  if (text.length < 80)
    return message("提取文字不足 80 字，请检查页面或补充正文");
  $("save").disabled = true;
  try {
    const { service, token } = await chrome.storage.local.get([
      "service",
      "token",
    ]);
    if (!service || !token) {
      connected = false;
      showConnection();
      throw new Error("请先连接 Fenext，再保存文章。");
    }
    const body = {
      title: $("title").value.trim().slice(0, 200),
      url: capture.url,
      text,
      urlMode: "reference",
      question: $("question").value.trim(),
      app: "Fenext插件",
    };
    const receipt = crypto.randomUUID();
    const response = await fetch(service + "/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "Idempotency-Key": receipt,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        connected = false;
        showConnection();
        throw new Error(
          "接收凭证无效或已过期，请重新连接。已提取的内容会保留。",
        );
      }
      throw new Error(data.error || "Fenext 接收失败");
    }
    capture = null;
    $("question").value = "";
    showCollector();
    message("已保存到 Fenext 收集箱。", true);
  } catch (e) {
    message(e.message);
  } finally {
    $("save").disabled = false;
  }
});
chrome.storage.local
  .get(["service", "token"])
  .then(({ service, token }) => {
    $("service").value = service || "http://127.0.0.1:4310";
    $("token").value = token || "";
    try {
      connected = !!token && !!service && serviceURL(service) === service;
    } catch {
      connected = false;
    }
    if (connected) {
      currentService = service;
      showCollector();
      void confirmSavedConnection(service, token);
      void checkUpdates();
    } else {
      showConnection();
      $("check-update").disabled = false;
    }
  })
  .catch(() => {
    showConnection();
    $("check-update").disabled = false;
    message("无法读取连接设置，请重新连接 Fenext。");
  });
