function safeURL(value) {
  const text = String(value || "").trim();
  if (text.length > 2000 || !/^https?:\/\/[^\s/?#@]+(?:[/?#]|$)/i.test(text))
    return "";
  return text;
}
function decode(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}
function normalizeEntry(query, launch) {
  const params = query || {};
  const materials =
    Number(launch?.scene) === 1173 &&
    /(?:^|\/)pages\/receive\/index$/.test(launch?.path || "") &&
    Array.isArray(launch?.forwardMaterials)
      ? launch.forwardMaterials
      : [];
  const source = {
    url: safeURL(decode(params.url)),
    title: decode(params.title).slice(0, 200),
    files: [],
    textFiles: [],
  };
  const unsupported = [];
  for (const material of materials) {
    const type = String(material.type || "").toLowerCase();
    const path = String(material.path || "");
    if (type === "text/html") {
      if (!source.url) source.url = safeURL(path);
      if (
        !source.url &&
        path &&
        !/^[a-z]+:\/\//i.test(path) &&
        Number(material.size) <= 2 * 1024 * 1024
      )
        source.textFiles.push({ path, html: true });
      else if (!source.url) unsupported.push("网页素材未提供可用链接");
    } else if (["image/png", "image/jpeg", "image/webp"].includes(type)) {
      if (source.files.length >= 4) unsupported.push("最多接收 4 张图片");
      else if (!path || Number(material.size) > 2 * 1024 * 1024)
        unsupported.push("图片缺失或超过 2 MB");
      else
        source.files.push({
          name: String(material.name || "文章图片").slice(0, 120),
          path,
          type,
        });
    } else if (["text/plain", "text/markdown"].includes(type)) {
      if (path && Number(material.size) <= 60000)
        source.textFiles.push({ path, html: false });
      else unsupported.push("文字素材缺失或超过 60000 字节");
    } else unsupported.push("暂不支持的素材类型：" + (type || "未知"));
  }
  return { source, unsupported, received: materials.length > 0 };
}
module.exports = { normalizeEntry, safeURL };
