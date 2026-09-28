import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  syncDirectory,
  serializeNote,
  parseNote,
  importDirectory,
  exportMaterials,
} from "../desktop/sync.mjs";
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fenext-sync-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const note = {
    id: "note-abc",
    title: "ReAct",
    aliases: ["行动循环"],
    level: "基础必学",
    version: 1,
    body: "## 是什么\n行动与观察。",
    updated_at: new Date().toISOString(),
  };
  let writes = 0;
  const api = async (p, b) => {
    if (p === "/me") return { id: "user-a" };
    if (p === "/notes") return [structuredClone(note)];
    if (p.endsWith("/sync")) {
      if (b.baseVersion !== note.version)
        return { conflict: true, suggestionId: "preserved-conflict" };
      writes++;
      note.body = b.body;
      note.version++;
      return { note: structuredClone(note) };
    }
    throw new Error("unexpected");
  };
  return {
    dir,
    note,
    api,
    get writes() {
      return writes;
    },
  };
}
test("Markdown YAML 往返保持身份和正文", () => {
  const n = {
    id: "abc",
    title: "A: [title]",
    aliases: ["别名"],
    level: "基础必学",
    version: 3,
    updated_at: "2026",
    body: "## 用途\n含 [[关联知识]] 和 ![](../附件/a.png)",
  };
  const parsed = parseNote(serializeNote(n));
  assert.equal(parsed.meta.fenext_id, n.id);
  assert.equal(parsed.body, n.body);
});
test("仅导出正文中明确写出的知识链接，并清理旧版自动图谱区", async (t) => {
  const f = await setup(t);
  const related = {
    ...f.note,
    id: "note-related",
    title: "工具调用",
    body: "## 用途\n执行外部动作。",
  };
  f.note.body += "\n参见 [[工具调用]]。";
  const api = async (route, body) => {
    if (route === "/notes") return [structuredClone(f.note), structuredClone(related)];
    return f.api(route, body);
  };
  const first = await syncDirectory(f.dir, api);
  const file = path.join(f.dir, first.paths[f.note.id]);
  const raw = await fs.readFile(file, "utf8");
  assert.match(raw, /\[\[工具调用--note-rel\|工具调用\]\]/);
  assert.doesNotMatch(raw, /fenext:graph:start/);
  assert.equal(parseNote(raw).body, f.note.body);
  const relatedRaw = await fs.readFile(path.join(f.dir, first.paths[related.id]), "utf8");
  assert.doesNotMatch(relatedRaw, /\[\[/);
  await syncDirectory(f.dir, api);
  assert.equal(f.writes, 0);
  const oldGraph = raw + "\n\n<!-- fenext:graph:start -->\n## 关联知识（同一来源或问题）\n- [[工具调用]]\n<!-- fenext:graph:end -->";
  await fs.writeFile(file, oldGraph.replace("fenext_links:", "fenext_graph:\n  - old-link\nfenext_links:"));
  await syncDirectory(f.dir, api);
  const withoutGraph = await fs.readFile(file, "utf8");
  assert.doesNotMatch(withoutGraph, /fenext:graph:start/);
  assert.doesNotMatch(withoutGraph, /fenext_graph:/);
  assert.equal(parseNote(withoutGraph).body, f.note.body);
});
test("双向同步、重复同步不循环回写、移动后保持身份", async (t) => {
  const f = await setup(t),
    first = await syncDirectory(f.dir, f.api);
  const filename = path.join(f.dir, first.paths[f.note.id]);
  let raw = await fs.readFile(filename, "utf8");
  raw = raw.replace("行动与观察。", "用户修改的解释。");
  await fs.writeFile(filename, raw);
  await syncDirectory(f.dir, f.api);
  assert.equal(f.writes, 1);
  assert.match(f.note.body, /用户修改/);
  await syncDirectory(f.dir, f.api);
  assert.equal(f.writes, 1);
  await fs.mkdir(path.join(f.dir, "移动"));
  await fs.rename(filename, path.join(f.dir, "移动", "重命名.md"));
  const moved = await syncDirectory(f.dir, f.api);
  assert.equal(moved.paths[f.note.id], path.join("移动", "重命名.md"));
  assert.equal(f.writes, 1);
});
test("并发冲突保留本地与服务端，不覆写文件", async (t) => {
  const f = await setup(t),
    first = await syncDirectory(f.dir, f.api),
    filename = path.join(f.dir, first.paths[f.note.id]);
  await fs.writeFile(
    filename,
    (await fs.readFile(filename, "utf8")).replace("行动与观察。", "本地改动。"),
  );
  f.note.body = "## 是什么\n云端改动。";
  f.note.version = 2;
  const r = await syncDirectory(f.dir, f.api);
  assert.equal(r.conflicts.length, 1);
  assert.match(await fs.readFile(filename, "utf8"), /本地改动/);
  assert.match(f.note.body, /云端改动/);
  assert.equal(f.writes, 0);
});
test("删除不传播，非标准笔记不覆盖，账户不得跨目录", async (t) => {
  const f = await setup(t);
  await fs.writeFile(path.join(f.dir, "自写笔记.md"), "用户内容");
  const r = await syncDirectory(f.dir, f.api);
  assert.equal(r.skipped, 1);
  assert.equal(
    await fs.readFile(path.join(f.dir, "自写笔记.md"), "utf8"),
    "用户内容",
  );
  await fs.unlink(path.join(f.dir, r.paths[f.note.id]));
  const next = await syncDirectory(f.dir, f.api);
  assert.equal(next.errors.length, 1);
  assert.equal(f.note.version, 1);
  await assert.rejects(
    () =>
      syncDirectory(f.dir, async (p) =>
        p === "/me" ? { id: "user-b" } : f.api(p),
      ),
    /另一账户/,
  );
});
test("拒绝通过符号链接写出绑定目录", async (t) => {
  const f = await setup(t),
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "fenext-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(f.dir, "知识"));
  await assert.rejects(() => syncDirectory(f.dir, f.api), /符号链接/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("正文写回保留自定义 YAML，内部链接转换后可还原", async (t) => {
  const f = await setup(t);
  f.note.body = "## 关联\n[[行动循环]]";
  const first = await syncDirectory(f.dir, f.api),
    file = path.join(f.dir, first.paths[f.note.id]);
  let raw = await fs.readFile(file, "utf8");
  assert.match(raw, /\[\[ReAct--note-abc\|行动循环\]\]/);
  assert.equal(parseNote(raw).body, f.note.body);
  raw = raw
    .replace("title: ReAct", "custom_property: 我的属性\ntitle: ReAct")
    .replace("## 关联", "## 我的关联");
  await fs.writeFile(file, raw);
  await syncDirectory(f.dir, f.api);
  const parsed = parseNote(await fs.readFile(file, "utf8"));
  assert.equal(parsed.meta.custom_property, "我的属性");
  assert.match(f.note.body, /\[\[行动循环\]\]/);
});
test("读取后用户再次编辑时，不覆盖文件", async (t) => {
  const f = await setup(t);
  const first = await syncDirectory(f.dir, f.api),
    file = path.join(f.dir, first.paths[f.note.id]);
  await fs.writeFile(
    file,
    (await fs.readFile(file, "utf8")).replace("行动与观察。", "第一次修改。"),
  );
  const wrapped = async (p, b) => {
    const r = await f.api(p, b);
    if (p.endsWith("/sync"))
      await fs.writeFile(
        file,
        (await fs.readFile(file, "utf8")).replace(
          "第一次修改。",
          "第二次修改。",
        ),
      );
    return r;
  };
  await assert.rejects(() => syncDirectory(f.dir, wrapped), /再次变化/);
  assert.match(await fs.readFile(file, "utf8"), /第二次修改/);
  assert.match(f.note.body, /第一次修改/);
});
test("显式导入保持原文与自定义属性，不重复导入", async (t) => {
  const f = await setup(t);
  await fs.writeFile(
    path.join(f.dir, "我的笔记.md"),
    "---\ntags:\n  - 自定义\n---\n\n# 自写标题\n用户正文。",
  );
  let calls = 0;
  const api = async (p, b) => {
    if (p === "/notes/import") {
      calls++;
      return { ...f.note, id: "imported-note", title: b.title, body: b.body };
    }
    return f.api(p, b);
  };
  assert.equal((await importDirectory(f.dir, api)).imported, 1);
  const parsed = parseNote(
    await fs.readFile(path.join(f.dir, "我的笔记.md"), "utf8"),
  );
  assert.equal(parsed.body, "# 自写标题\n用户正文。");
  assert.deepEqual(parsed.meta.tags, ["自定义"]);
  assert.equal((await importDirectory(f.dir, api)).imported, 0);
  assert.equal(calls, 1);
});
test("来源、图片与问题索引按相对路径导出，不覆盖现有快照", async (t) => {
  const f = await setup(t);
  const notes = [{ ...f.note, questions: ["如何观察结果？"] }];
  const api = async (p) =>
    p === "/sync/materials"
      ? [
          {
            id: "source-1",
            title: "来源示例",
            ranges: ["提交图片"],
            input: {
              text: "资料正文",
              url: "",
              images: [{ data: "data:image/png;base64,iVBORw0KGgo=" }],
            },
          },
        ]
      : notes;
  await exportMaterials(f.dir, api, { [f.note.id]: "知识/ReAct.md" });
  assert.ok((await fs.readdir(path.join(f.dir, "问题索引"))).length);
  const sources = await fs.readdir(path.join(f.dir, "来源"));
  const source = path.join(f.dir, "来源", sources[0]);
  assert.match(await fs.readFile(source, "utf8"), /\.\.\/附件\/source-1-0.png/);
  await fs.writeFile(source, "我的备注");
  await exportMaterials(f.dir, api, { [f.note.id]: "知识/ReAct.md" });
  assert.equal(await fs.readFile(source, "utf8"), "我的备注");
});
