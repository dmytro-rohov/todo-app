// The AI layer without a network: provider settings (AI_* and the older ANTHROPIC_*), one structured() call answered
// by Anthropic or by an OpenAI-compatible API, and the same readable errors whichever provider answers.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadAi, structured, AiError } = require("../ai");

const load = (env, { isProduction = false } = {}) => { const errors = []; return { ai: loadAi(env, errors, { isProduction }), errors }; };
const TOOL = { name: "route_task", description: "Decide", schema: { type: "object", required: ["coding"], properties: { coding: { type: "boolean" } } } };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const recorder = answer => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return answer; };
  return { calls, fetchImpl };
};

test("settings: Anthropic by default (also from ANTHROPIC_*), OpenAI or any OpenAI-compatible API by choice", () => {
  assert.equal(load({}).ai, null); // no key: AI off
  let { ai, errors } = load({ ANTHROPIC_API_KEY: "sk-ant" });
  assert.deepEqual([ai.provider, ai.model, ai.apiBase, ai.label, errors.length], ["anthropic", "claude-sonnet-5-5", "https://api.anthropic.com", "Claude (Anthropic)", 0]);
  ({ ai } = load({ AI_API_KEY: "k", AI_MODEL: "claude-opus-5-5" }));
  assert.equal(ai.model, "claude-opus-5-5");
  ({ ai, errors } = load({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-oa" }));
  assert.match(errors[0], /AI_MODEL is required/); // no guessed default model
  ({ ai, errors } = load({ AI_PROVIDER: "openai", AI_API_KEY: "sk-oa", AI_MODEL: "gpt-x" }));
  assert.deepEqual([ai.provider, ai.apiBase, ai.label, errors.length], ["openai", "https://api.openai.com", "OpenAI", 0]);
  ({ ai } = load({ AI_PROVIDER: "openai", AI_API_KEY: "k", AI_MODEL: "mistral-large-latest", AI_API_BASE: "https://api.mistral.ai/", AI_LABEL: "Mistral" }));
  assert.deepEqual([ai.apiBase, ai.label], ["https://api.mistral.ai", "Mistral"]);
  assert.match(load({ AI_PROVIDER: "openai", AI_API_KEY: "k", AI_MODEL: "gpt-x", AI_API_BASE: "http://plain" }).errors[0], /https/);
  assert.match(load({ AI_PROVIDER: "gemini", AI_API_KEY: "k" }).errors[0], /AI_PROVIDER must be one of: anthropic, openai/);
  // a local fake API only outside production
  assert.equal(load({ AI_API_KEY: "k", AI_DEV_BASE: "http://127.0.0.1:1" }).ai.apiBase, "http://127.0.0.1:1");
  assert.equal(load({ AI_API_KEY: "k", AI_DEV_BASE: "http://evil" }, { isProduction: true }).ai.apiBase, "https://api.anthropic.com");
});

test("Anthropic: the answer is forced into the tool", async () => {
  const { calls, fetchImpl } = recorder(reply(200, { content: [{ type: "tool_use", name: "route_task", input: { coding: true } }] }));
  const ai = load({ AI_API_KEY: "sk-ant" }).ai;
  assert.deepEqual(await structured(ai, { system: "S", content: "C", tool: TOOL, fetchImpl }), { coding: true });
  const [call] = calls;
  assert.equal(call.url, "https://api.anthropic.com/v1/messages");
  assert.equal(call.headers["x-api-key"], "sk-ant");
  assert.deepEqual(call.body.tool_choice, { type: "tool", name: "route_task" });
  assert.deepEqual(call.body.tools[0].input_schema, TOOL.schema);
});

test("OpenAI-compatible: a forced function call, its JSON arguments parsed", async () => {
  const { calls, fetchImpl } = recorder(reply(200, { choices: [{ message: { tool_calls: [{ type: "function",
    function: { name: "route_task", arguments: "{\"coding\":false}" } }] } }] }));
  const ai = load({ AI_PROVIDER: "openai", AI_API_KEY: "sk-oa", AI_MODEL: "gpt-x", AI_API_BASE: "https://openrouter.ai/api" }).ai;
  assert.deepEqual(await structured(ai, { system: "S", content: "C", tool: TOOL, fetchImpl }), { coding: false });
  const [call] = calls;
  assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(call.headers.authorization, "Bearer sk-oa");
  assert.deepEqual(call.body.messages.map(m => m.role), ["system", "user"]);
  assert.deepEqual(call.body.tool_choice, { type: "function", function: { name: "route_task" } });
  assert.deepEqual(call.body.tools[0].function.parameters, TOOL.schema);
  // malformed arguments or no call: an error, never a guess
  for (const body of [{ choices: [{ message: { tool_calls: [{ function: { name: "route_task", arguments: "{oops" } }] } }] }, { choices: [{ message: { content: "hi" } }] }]) {
    await assert.rejects(structured(ai, { system: "S", content: "C", tool: TOOL, fetchImpl: async () => reply(200, body) }), /nie zwróciło odpowiedzi/);
  }
});

test("errors read the same whichever provider answers", async () => {
  const anthropic = load({ AI_API_KEY: "k" }).ai;
  const openai = load({ AI_PROVIDER: "openai", AI_API_KEY: "k", AI_MODEL: "gpt-x" }).ai;
  const cases = [
    [anthropic, reply(401, {}), /Klucz API AI/], [openai, reply(401, {}), /Klucz API AI/],
    [anthropic, reply(400, { error: { message: "Your credit balance is too low" } }), /Brak środków/],
    [openai, reply(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } }), /Brak środków/],
    [anthropic, reply(429, {}), /Limit zapytań/], [openai, reply(429, { error: { code: "rate_limit_exceeded" } }), /Limit zapytań/],
    [openai, reply(400, { error: { message: "bad" } }), /odrzuciło/], [anthropic, reply(503, {}), /nie odpowiada/]
  ];
  for (const [ai, answer, message] of cases) {
    await assert.rejects(structured(ai, { system: "S", content: "C", tool: TOOL, fetchImpl: async () => answer }),
      error => error instanceof AiError && message.test(error.message), `${ai.provider} ${answer.status}`);
  }
  await assert.rejects(structured(openai, { system: "S", content: "C", tool: TOOL, fetchImpl: async () => { throw new Error("ECONNREFUSED"); } }), /nie odpowiada/);
});
