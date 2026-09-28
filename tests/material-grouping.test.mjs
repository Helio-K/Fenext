import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";
import { submit, taskJSON, materialIdentity } from "../server/domain.mjs";

test("same material, different questions retain independent tasks and results, ignoring titles", () => {
  const { db, uid } = fixture();
  try {
    const a = submit(
      db,
      uid,
      { text: "原文", question: "概括", title: "文章" },
      "a",
    );
    const b = submit(
      db,
      uid,
      { text: "原文", question: "如何应用", title: "另一标题" },
      "b",
    );
    const c = submit(
      db,
      uid,
      { text: "不同原文", question: "概括", title: "文章" },
      "c",
    );
    assert.notEqual(a.id, b.id);
    assert.equal(taskJSON(a).material.key, taskJSON(b).material.key);
    assert.notEqual(taskJSON(a).material.key, taskJSON(c).material.key);
    assert.equal(taskJSON(a).question, "概括");
    assert.equal(taskJSON(b).question, "如何应用");
    assert.equal(
      submit(db, uid, { text: "原文", question: "概括" }, "retry").id,
      a.id,
    );
  } finally {
    db.close();
  }
});

test("URL normalization, snapshots and unread links are conservative", () => {
  const task = (id, input, read) => ({
    id,
    input: JSON.stringify({ images: [], ...input }),
    checkpoint: JSON.stringify(read ? { read } : {}),
  });
  const a = task("a", {
    url: "https://example.com/article#one",
    text: "正文",
    urlMode: "reference",
  });
  const b = task("b", {
    url: "https://example.com/article#two",
    text: "正文",
    urlMode: "reference",
  });
  assert.equal(materialIdentity(a).key, materialIdentity(b).key);
  const changed = task("c", {
    url: "https://example.com/article",
    text: "新正文",
    urlMode: "reference",
  });
  assert.equal(
    materialIdentity(a).sourceKey,
    materialIdentity(changed).sourceKey,
  );
  assert.notEqual(materialIdentity(a).key, materialIdentity(changed).key);
  const other = task("d", {
    url: "https://example.com/other",
    text: "正文",
    urlMode: "reference",
  });
  assert.notEqual(materialIdentity(a).key, materialIdentity(other).key);
  const unread = task("u", { url: "https://example.com/article" });
  assert.equal(materialIdentity(unread).verified, false);
  assert.notEqual(
    materialIdentity(unread).key,
    materialIdentity({ ...unread, id: "v" }).key,
  );
  const fetched = {
    ...unread,
    checkpoint: JSON.stringify({ read: [{ kind: "web", content: "正文" }] }),
  };
  assert.equal(materialIdentity(fetched).key, materialIdentity(a).key);
  const updated = {
    ...fetched,
    checkpoint: JSON.stringify({ read: [{ kind: "web", content: "新正文" }] }),
  };
  assert.equal(materialIdentity(updated).key, materialIdentity(changed).key);
  assert.equal(JSON.parse(fetched.checkpoint).read[0].content, "正文");
});

test("image identity uses bytes instead of file names", () => {
  const task = (name, data) => ({
    id: name,
    input: JSON.stringify({ images: [{ name, data }] }),
    checkpoint: "{}",
  });
  assert.equal(
    materialIdentity(task("a.png", "image-one")).key,
    materialIdentity(task("b.png", "image-one")).key,
  );
  assert.notEqual(
    materialIdentity(task("a.png", "image-one")).key,
    materialIdentity(task("a.png", "image-two")).key,
  );
});
