export const sourceBlockedMessage =
  "未读到文章正文：微信公众号返回了验证或访问受限页面。请在微信中打开原文并完成验证，再提交正文或截图。";

export function isWechatChallengeURL(value) {
  try {
    const u = new URL(value);
    return (
      u.hostname === "mp.weixin.qq.com" &&
      /\/(?:wappoc_appmsgcaptcha|appmsgcaptcha)(?:\/|$)/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

// Used only for historical extracted pages, never to classify an AI summary.
export function isBlockedWechatRead(source) {
  if (source.kind !== "web") return false;
  if (isWechatChallengeURL(source.url)) return true;
  try {
    return (
      new URL(source.url).hostname === "mp.weixin.qq.com" &&
      !source.title?.trim() &&
      (source.content || "").length < 500 &&
      /^环境异常\s*(?:当前环境异常[，,]?\s*)?(?:[，,]\s*)?完成验证后/.test(
        source.content || "",
      )
    );
  } catch {
    return false;
  }
}

export function archiveBlockedCheckpoint(cp, result = null) {
  const { read, analysis, noteVersions, ...rest } = cp;
  return {
    ...rest,
    readingFailureArchive: { read, analysis, noteVersions, result },
    sourceIssue: { code: "SOURCE_BLOCKED", message: sourceBlockedMessage },
  };
}

export function repairBlockedCompletions(db) {
  let count = 0;
  for (const task of db
    .prepare(
      "SELECT id,input,checkpoint,result FROM tasks WHERE stage='completed'",
    )
    .all()) {
    const input = JSON.parse(task.input),
      cp = JSON.parse(task.checkpoint),
      result = JSON.parse(task.result || "null");
    if (
      input.text?.trim() ||
      input.images?.length ||
      !result ||
      !["new", "existing", "updates", "uncertain"].every(
        (key) => Array.isArray(result[key]) && result[key].length === 0,
      )
    )
      continue;
    if (!cp.read?.length || !cp.read.every(isBlockedWechatRead)) continue;
    // Never alter a task already linked to knowledge or review suggestions.
    if (
      db
        .prepare(
          "SELECT 1 FROM sources WHERE task_id=? UNION ALL SELECT 1 FROM suggestions WHERE task_id=? LIMIT 1",
        )
        .get(task.id, task.id)
    )
      continue;
    db.prepare(
      "UPDATE tasks SET stage='failed',result=NULL,checkpoint=?,error=?,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND stage='completed'",
    ).run(
      JSON.stringify(archiveBlockedCheckpoint(cp, result)),
      sourceBlockedMessage,
      new Date().toISOString(),
      task.id,
    );
    count++;
  }
  return count;
}
