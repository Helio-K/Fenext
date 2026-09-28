import test from "node:test";
import assert from "node:assert/strict";
import { completion, parseModelJSON, analysisSchema } from "../server/ai.mjs";
import { encrypt } from "../server/security.mjs";
const output = { summary: "依据材料，没有可收录项", items: [] };
const settings = {
  endpoint: "https://api.deepseek.com",
  model: "deepseek-flash",
  key_cipher: encrypt("fixture-only"),
};
const messages = [{ role: "system", content: "输出 JSON" }];
const reply = (content, finish_reason = "stop") =>
  new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason }] }),
    { status: 200 },
  );

test("模型 JSON 接受完整代码块；拒绝截断、伪 JSON 和不符合 schema 的对象", () => {
  assert.deepEqual(
    parseModelJSON(
      "```json\n" + JSON.stringify(output) + "\n```",
      analysisSchema,
    ),
    output,
  );
  assert.throws(() => parseModelJSON('{"summary":"截断', analysisSchema));
  assert.throws(() =>
    parseModelJSON("解释：" + JSON.stringify(output), analysisSchema),
  );
  assert.throws(() =>
    parseModelJSON('{"summary":"缺少 items"}', analysisSchema),
  );
});
test("截断回复即使 JSON 可解析也不能收录，最多重新生成一次", async () => {
  const requests = [];
  const result = await completion(settings, messages, analysisSchema, {
    fetcher: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1
        ? reply(JSON.stringify(output), "length")
        : reply(JSON.stringify(output));
    },
  });
  assert.deepEqual(result, output);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].max_tokens, 16000);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.equal(requests[1].messages.at(-1).role, "system");
  assert.match(requests[1].messages.at(-1).content, /原始材料/);
});
test("连续空回复明确报错，无无限重试；无效密钥不会格式重试", async () => {
  let count = 0;
  await assert.rejects(
    completion(settings, messages, analysisSchema, {
      fetcher: async () => {
        count++;
        return reply(null);
      },
    }),
    /空回复.*自动重新生成一次/,
  );
  assert.equal(count, 2);
  count = 0;
  await assert.rejects(
    completion(settings, messages, analysisSchema, {
      fetcher: async () => {
        count++;
        return new Response("unauthorized", { status: 401 });
      },
    }),
    /密钥无效/,
  );
  assert.equal(count, 1);
});
test("其他提供方保持原预算，不发送 DeepSeek 的思考参数", async () => {
  let request;
  await completion(
    { ...settings, endpoint: "https://api.openai.com/v1", model: "fixture" },
    messages,
    analysisSchema,
    {
      fetcher: async (_url, options) => {
        request = JSON.parse(options.body);
        return reply(JSON.stringify(output));
      },
    },
  );
  assert.equal(request.max_tokens, 8000);
  assert.equal(request.reasoning_effort, undefined);
});
