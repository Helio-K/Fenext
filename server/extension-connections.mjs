import { now } from "./db.mjs";

export function confirmExtensionConnection(db, auth, req, url) {
  const origin = req.headers.origin || "";
  if (
    auth.kind !== "ingestion" ||
    !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)
  )
    return;
  const requested = url.searchParams.get("browser");
  const browser = ["chrome", "edge"].includes(requested)
    ? requested
    : /Edg\//.test(req.headers["user-agent"] || "")
      ? "edge"
      : "chrome";
  const rawVersion = url.searchParams.get("version") || "";
  const version =
    /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(rawVersion) &&
    rawVersion.split(".").every((n) => Number(n) <= 65535)
      ? rawVersion
      : "";
  db.prepare(
    `INSERT INTO extension_connections(user_id,token_hash,browser,extension_id,version,verified_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,token_hash,browser,extension_id) DO UPDATE SET
    version=CASE WHEN excluded.version='' THEN extension_connections.version ELSE excluded.version END,
    verified_at=excluded.verified_at`,
  ).run(
    auth.user_id,
    auth.token_hash,
    browser,
    origin.slice("chrome-extension://".length),
    version,
    now(),
  );
}

export function extensionConnectionStatus(db, userId) {
  const connections = db
    .prepare(
      `SELECT c.browser,c.version,c.verified_at,s.expires_at,
    CASE WHEN s.kind='ingestion' AND (s.expires_at IS NULL OR s.expires_at>?) THEN 1 ELSE 0 END AS active
    FROM extension_connections c LEFT JOIN sessions s ON s.token_hash=c.token_hash AND s.user_id=c.user_id
    WHERE c.user_id=? ORDER BY c.verified_at DESC`,
    )
    .all(now(), userId)
    .map((row) => ({
      browser: row.browser,
      version: row.version,
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at || null,
      active: !!row.active,
    }));
  const historical =
    !connections.length &&
    !!db
      .prepare(
        "SELECT 1 FROM tasks WHERE user_id=? AND stage!='deleted' AND app IN ('Fenext插件','Fenext 浏览器插件') LIMIT 1",
      )
      .get(userId);
  return {
    state: connections.some((c) => c.active)
      ? "connected"
      : connections.length
        ? "expired"
        : historical
          ? "unverified"
          : "disconnected",
    connections,
  };
}
