import test from "node:test";
import assert from "node:assert/strict";
import { readMaterial, readWebPage } from "../server/reader.mjs";
import { inputSchema, submit } from "../server/domain.mjs";
import { claim, runTask } from "../server/worker.mjs";
import { fixture } from "./helpers.mjs";
const url = "https://mp.weixin.qq.com/s/example";
const blocked =
  "<html><body>环境异常，完成验证后即可继续访问。<button>去验证</button></body></html>";

test("公众号验证页在读取阶段失败，不调用模型、不产出空的完成结果", async () => {
  const { db, uid } = fixture();
  try {
    submit(db, uid, { url }, "blocked");
    const task = claim(db);
    let calls = 0;
    await runTask(db, task, {
      reader: (input) =>
        readMaterial(input, {
          fetcher: async () => ({
            url,
            type: "text/html",
            bytes: Buffer.from(blocked),
          }),
        }),
      analyzer: async () => {
        calls++;
        throw new Error("不应调用");
      },
    });
    const saved = db.prepare("SELECT * FROM tasks WHERE id=?").get(task.id);
    assert.equal(saved.stage, "failed");
    assert.equal(saved.result, null);
    assert.equal(
      JSON.parse(saved.checkpoint).sourceIssue.code,
      "SOURCE_BLOCKED",
    );
    assert.match(saved.error, /未读到文章正文/);
    assert.equal(calls, 0);
    assert.equal(claim(db), null);
  } finally {
    db.close();
  }
});

test("正文中讨论环境异常不误判为拦截；仅提取正文而非界面文案", () => {
  const content =
    "这是一篇讨论环境异常和访问验证的技术文章，介绍多智能体任务的协调方法、失败恢复、结果核验与权限边界。".repeat(
      3,
    );
  const result = readWebPage(
    `<html><title>页面</title><body><h1 id="activity-name">多智能体最佳实践</h1><div id="js_content">${content}</div><p>完成验证后即可继续访问</p></body></html>`,
    url,
  );
  assert.equal(result.title, "多智能体最佳实践");
  assert.equal(result.content, content);
  assert.match(result.range, /不包含图片/);
});

test("仅引用链接时不联网；手动文字和截图保留来源及真实读取范围", async () => {
  let calls = 0;
  const result = await readMaterial(
    {
      url,
      urlMode: "reference",
      text: "用户粘贴的正文",
      images: [{ name: "文章截图.png" }],
    },
    {
      fetcher: async () => {
        calls++;
        throw new Error("不应联网");
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.length, 2);
  assert.equal(result[0].content, "用户粘贴的正文");
  for (const source of result) {
    assert.equal(source.url, url);
    assert.match(source.range, /未读取链接正文/);
  }
  await assert.rejects(
    readMaterial({ url, urlMode: "reference", images: [] }),
    /粘贴正文/,
  );
  assert.throws(
    () => inputSchema.parse({ url, urlMode: "reference" }),
    /粘贴正文/,
  );
});

test("读取链接与仅引用链接是不同资料，默认读取模式保持去重兼容", () => {
  const { db, uid } = fixture();
  try {
    const input = { url, text: "正文" };
    const a = submit(db, uid, input, "a");
    assert.equal(submit(db, uid, { ...input, urlMode: "read" }, "b").id, a.id);
    const reference = submit(db, uid, { ...input, urlMode: "reference" }, "c");
    assert.notEqual(reference.id, a.id);
    assert.throws(
      () => submit(db, uid, { ...input, urlMode: "reference" }, "a"),
      /不同资料/,
    );
  } finally {
    db.close();
  }
});

test("历史验证页空结果改为失败并保留诊断；真实空结果不改，修复可重复执行", async () => {
  const { repairBlockedCompletions } =
    await import("../server/source-access.mjs");
  const { db, uid } = fixture();
  try {
    const empty = {
      new: [],
      existing: [],
      updates: [],
      uncertain: [],
      summary: "无可收录的知识点",
    };
    const bad = submit(db, uid, { url }, "old-blocked");
    const good = submit(
      db,
      uid,
      { url: "https://example.com/article" },
      "valid-empty",
    );
    const cp = {
      read: [
        {
          kind: "web",
          url: "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?target_url=example",
          content: "环境异常 当前环境异常，完成验证后即可继续访问。 去验证",
          title: "",
        },
      ],
      analysis: { summary: "旧模型诊断", items: [] },
    };
    db.prepare(
      "UPDATE tasks SET stage='completed',result=?,checkpoint=? WHERE id=?",
    ).run(JSON.stringify(empty), JSON.stringify(cp), bad.id);
    db.prepare(
      "UPDATE tasks SET stage='completed',result=?,checkpoint=? WHERE id=?",
    ).run(
      JSON.stringify(empty),
      JSON.stringify({
        read: [
          {
            kind: "web",
            url: "https://example.com/article",
            content: "有效正文，但与用户的知识目标无关。",
          },
        ],
      }),
      good.id,
    );
    assert.equal(repairBlockedCompletions(db), 1);
    assert.equal(repairBlockedCompletions(db), 0);
    const repaired = db.prepare("SELECT * FROM tasks WHERE id=?").get(bad.id);
    assert.equal(repaired.stage, "failed");
    assert.equal(repaired.result, null);
    const saved = JSON.parse(repaired.checkpoint);
    assert.equal(saved.read, undefined);
    assert.equal(saved.analysis, undefined);
    assert.deepEqual(saved.readingFailureArchive.result, empty);
    assert.deepEqual(saved.readingFailureArchive.read, cp.read);
    assert.equal(
      db.prepare("SELECT stage FROM tasks WHERE id=?").get(good.id).stage,
      "completed",
    );
    // A manual retry must read again instead of reusing the old empty analysis.
    db.prepare("UPDATE tasks SET stage='queued',next_at=0 WHERE id=?").run(
      bad.id,
    );
    let reads = 0,
      analyses = 0;
    await runTask(db, claim(db), {
      reader: async () => {
        reads++;
        return [{ kind: "text", content: "重新读取的正文" }];
      },
      analyzer: async () => {
        analyses++;
        return { summary: "已读取但无新增知识", items: [] };
      },
    });
    assert.equal(reads, 1);
    assert.equal(analyses, 1);
    const retried = db.prepare("SELECT * FROM tasks WHERE id=?").get(bad.id);
    assert.equal(retried.stage, "completed");
    assert.equal(JSON.parse(retried.checkpoint).sourceIssue, undefined);
  } finally {
    db.close();
  }
});

test("验证页重定向优先于正文选择器；旧读取检查点不能直接交给模型", async () => {
  const { db, uid } = fixture();
  try {
    const challenge = "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha";
    assert.throws(
      () =>
        readWebPage(
          '<body><div id="js_content">验证控件</div></body>',
          challenge,
        ),
      (e) => e.code === "SOURCE_BLOCKED",
    );
    const task = submit(db, uid, { url }, "checkpoint");
    db.prepare("UPDATE tasks SET checkpoint=? WHERE id=?").run(
      JSON.stringify({
        read: [{ kind: "web", url: challenge, content: "验证页" }],
        analysis: { summary: "误读", items: [] },
      }),
      task.id,
    );
    await runTask(db, claim(db), {
      analyzer: async () => {
        assert.fail("不应复用拦截页");
      },
    });
    const saved = db.prepare("SELECT * FROM tasks WHERE id=?").get(task.id);
    assert.equal(saved.stage, "failed");
    assert.equal(saved.result, null);
    assert.equal(JSON.parse(saved.checkpoint).read, undefined);
  } finally {
    db.close();
  }
});
