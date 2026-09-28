import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
const digest = (s) => crypto.createHash("sha256").update(s).digest("hex");
const safeTitle = (s) =>
  s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 80) || "知识";
export function serializeNote(note, extra = {}) {
  const linkMap = note.linkMap || {};
  const meta = { ...extra };
  delete meta.fenext_links;
  delete meta.fenext_graph;
  const body = note.body.replace(/\[\[([^\]\n]+)\]\]/g, (full, value) => {
    const [target, label] = value.split("|");
    return linkMap[target] ? `[[${linkMap[target]}|${label || target}]]` : full;
  });
  return `---\n${YAML.stringify({ ...meta, fenext_id: note.id, title: note.title, aliases: note.aliases, learning_level: note.level, fenext_version: note.version, updated_at: note.updated_at, ...(Object.keys(linkMap).length ? { fenext_links: linkMap } : {}) })}---\n\n${body}`;
}
export function parseNote(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)?/);
  if (!m) return { meta: {}, body: raw };
  let meta;
  try {
    meta = YAML.parse(m[1], { maxAliasCount: 0 }) || {};
    if (typeof meta !== "object" || Array.isArray(meta))
      throw new Error("Invalid frontmatter");
  } catch {
    throw new Error("笔记 YAML 无法解析，已保留原文件");
  }
  let body = raw.slice(m[0].length);
  const graphStart = body.indexOf("\n\n<!-- fenext:graph:start -->");
  if (graphStart !== -1) {
    const graphEnd = body.indexOf("<!-- fenext:graph:end -->", graphStart);
    if (graphEnd !== -1)
      body = body.slice(0, graphStart) + body.slice(graphEnd + "<!-- fenext:graph:end -->".length);
  }
  if (meta.fenext_links && typeof meta.fenext_links === "object")
    body = body.replace(/\[\[([^\]\n]+)\]\]/g, (full, value) => {
      const [target, label] = value.split("|");
      const original = Object.entries(meta.fenext_links).find(
        ([, v]) => v === target,
      )?.[0];
      return original
        ? `[[${original}${label && label !== original ? "|" + label : ""}]]`
        : full;
    });
  return { meta, body };
}
async function safeFile(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error("路径超出绑定目录");
  let current = root;
  for (const bit of path.relative(root, target).split(path.sep)) {
    current = path.join(current, bit);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink())
        throw new Error("同步范围内不允许符号链接：" + relative);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return target;
}
async function atomicWrite(root, relative, content, expectedRaw) {
  const target = await safeFile(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + ".fenext-" + crypto.randomUUID() + ".tmp";
  try {
    await fs.writeFile(tmp, content, { flag: "wx" });
    if (expectedRaw !== undefined) {
      const current = await fs.readFile(target, "utf8").catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (current !== expectedRaw)
        throw new Error(
          "写入前检测到文件再次变化，已保留双方内容：" + relative,
        );
    }
    await fs.rename(tmp, target);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
export async function scanNotes(root) {
  const results = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (
        entry.isDirectory() &&
        !["来源", "问题索引", "附件"].includes(entry.name)
      )
        await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const stat = await fs.stat(full);
        if (stat.size > 500000) continue;
        results.push({
          relative: path.relative(root, full),
          raw: await fs.readFile(full, "utf8"),
        });
      }
      if (results.length > 2000)
        throw new Error("绑定目录超过 2000 篇笔记，请选择专用子目录");
    }
  }
  await walk(root);
  return results;
}
export async function syncDirectory(directory, api) {
  const root = await fs.realpath(directory);
  const user = await api("/me");
  const manifestPath = await safeFile(root, ".fenext-sync.json");
  let state;
  try {
    state = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT")
      throw new Error("同步索引损坏，请先备份目录再恢复");
    state = { userId: user.id, notes: {} };
  }
  if (state.userId !== user.id)
    throw new Error("此目录已绑定另一账户，不能交叉同步");
  const scanned = await scanNotes(root),
    managed = new Map(),
    errors = [],
    conflicts = [],
    changed = [];
  for (const file of scanned) {
    try {
      const parsed = parseNote(file.raw);
      const id = parsed.meta.fenext_id;
      if (id) {
        if (managed.has(id))
          throw new Error("同一知识标识出现在多个文件中：" + file.relative);
        managed.set(id, { ...file, ...parsed });
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length) throw new Error(errors.join("；"));
  let skipped = scanned.filter((f) => !parseNote(f.raw).meta.fenext_id).length;
  const notes = await api("/notes");
  const notePaths = Object.fromEntries(
    notes.map((note) => [
      note.id,
      managed.get(note.id)?.relative ||
        state.notes[note.id]?.path ||
        path.join(
          "知识",
          `${safeTitle(note.title)}--${note.id.slice(0, 8)}.md`,
        ),
    ]),
  );
  const names = new Map();
  for (const n of notes)
    for (const name of [n.title, ...n.aliases]) {
      const matches = names.get(name) || new Set();
      matches.add(n.id);
      names.set(name, matches);
    }
  function links(note, localPath) {
    const map = {};
    for (const match of note.body.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const name = match[1].split("|")[0],
        ids = names.get(name);
      if (ids?.size === 1)
        map[name] = path
          .relative(path.dirname(localPath), notePaths[[...ids][0]])
          .replaceAll(path.sep, "/")
          .replace(/\.md$/, "");
    }
    return map;
  }
  for (const note of notes) {
    const previous = state.notes[note.id],
      file = managed.get(note.id);
    let localPath =
      file?.relative ||
      previous?.path ||
      path.join("知识", `${safeTitle(note.title)}--${note.id.slice(0, 8)}.md`);
    note.linkMap = links(note, localPath);
    await safeFile(root, localPath);
    if (previous && !file) {
      errors.push(
        `${note.title}：本地文件已移除，未传播删除；恢复文件或解除目录绑定后重新比较`,
      );
      continue;
    }
    if (file) {
      const baseVersion =
        previous?.version || Number(file.meta.fenext_version) || note.version;
      const localChanged = previous
        ? digest(file.body) !== previous.hash
        : file.body !== note.body;
      const remoteChanged = previous
        ? note.version !== previous.version
        : note.version !== baseVersion;
      if (localChanged && file.body !== note.body) {
        // Keep the local file intact until the server confirms the matching base version.
        const result = await api(`/notes/${note.id}/sync`, {
          body: file.body,
          baseVersion,
        });
        if (result.conflict) {
          conflicts.push({
            noteId: note.id,
            title: note.title,
            suggestionId: result.suggestionId,
          });
          continue;
        }
        Object.assign(note, result.note);
        changed.push(note.title);
      } else if (
        !localChanged &&
        !remoteChanged &&
        JSON.stringify(file.meta.fenext_links || {}) ===
          JSON.stringify(note.linkMap) &&
        !file.meta.fenext_graph
      ) {
        state.notes[note.id] = {
          path: localPath,
          version: note.version,
          hash: digest(note.body),
        };
        continue;
      }
    } else {
      try {
        await fs.access(await safeFile(root, localPath));
        throw new Error("目标文件已存在，拒绝覆盖：" + localPath);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    note.linkMap = links(note, localPath);
    await atomicWrite(
      root,
      localPath,
      serializeNote(note, file?.meta),
      file?.raw ?? null,
    );
    state.notes[note.id] = {
      path: localPath,
      version: note.version,
      hash: digest(note.body),
    };
  }
  await atomicWrite(root, ".fenext-sync.json", JSON.stringify(state, null, 2));
  return {
    count: notes.length,
    conflicts,
    errors,
    skipped,
    changed,
    summary: `已检查 ${notes.length} 篇 · 冲突 ${conflicts.length} 项 · 保留 ${skipped} 篇未纳管笔记`,
    paths: Object.fromEntries(
      Object.entries(state.notes).map(([id, n]) => [id, n.path]),
    ),
  };
}

export async function importDirectory(directory, api) {
  const root = await fs.realpath(directory),
    user = await api("/me");
  try {
    const state = JSON.parse(
      await fs.readFile(await safeFile(root, ".fenext-sync.json"), "utf8"),
    );
    if (state.userId !== user.id) throw new Error("此目录属于另一账户");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const files = await scanNotes(root);
  let count = 0;
  for (const file of files) {
    const parsed = parseNote(file.raw);
    if (parsed.meta.fenext_id) continue;
    const aliases = Array.isArray(parsed.meta.aliases)
      ? parsed.meta.aliases.filter((v) => typeof v === "string")
      : [];
    const note = await api("/notes/import", {
      title:
        typeof parsed.meta.title === "string"
          ? parsed.meta.title
          : path.basename(file.relative, ".md"),
      body: parsed.body,
      aliases,
      sourceKey: digest(file.relative + "\n" + file.raw),
    });
    await atomicWrite(
      root,
      file.relative,
      serializeNote(note, parsed.meta),
      file.raw,
    );
    count++;
  }
  return { imported: count };
}

export async function exportMaterials(directory, api, notePaths) {
  const root = await fs.realpath(directory),
    materials = await api("/sync/materials");
  let exported = 0;
  // Only create immutable source snapshots. Existing user files are never replaced.
  async function create(relative, content) {
    const target = await safeFile(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(target, content, { flag: "wx" });
      exported++;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  for (const s of materials) {
    const images = [];
    for (let i = 0; i < s.input.images.length; i++) {
      const im = s.input.images[i],
        mime = im.data.slice(5, im.data.indexOf(";")),
        ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
          mime
        ];
      if (!ext) continue;
      const relative = path.join("附件", `${s.id}-${i}.${ext}`);
      await create(relative, Buffer.from(im.data.split(",")[1], "base64"));
      images.push(`![](../附件/${s.id}-${i}.${ext})`);
    }
    await create(
      path.join("来源", `${safeTitle(s.title)}--${s.id.slice(0, 8)}.md`),
      `# ${s.title}\n\n${s.input.url || ""}\n\n读取范围：${s.ranges.join("；")}\n\n${s.input.text || ""}\n\n${images.join("\n\n")}`,
    );
  }
  const notes = await api("/notes");
  const groups = new Map();
  for (const n of notes)
    for (const q of n.questions || []) {
      if (!groups.has(q)) groups.set(q, []);
      groups.get(q).push(n);
    }
  for (const [q, items] of groups) {
    const body =
      `# ${q}\n\n` +
      items
        .map(
          (n) =>
            `- [[${path.relative("问题索引", notePaths[n.id]).replaceAll(path.sep, "/").replace(/\.md$/, "")}|${n.title}]]`,
        )
        .join("\n");
    const suffix = digest(body).slice(0, 8);
    await create(path.join("问题索引", `${safeTitle(q)}--${suffix}.md`), body);
  }
  return { exported };
}
