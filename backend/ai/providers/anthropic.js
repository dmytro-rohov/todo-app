// Anthropic Messages API (Claude). The answer is forced into one tool call, so it is JSON of the request's schema.
const API_VERSION = "2023-06-01";

module.exports = {
  label: "Claude (Anthropic)",
  apiBase: "https://api.anthropic.com",
  defaultModel: "claude-sonnet-5-5",

  request(ai, { system, content, tool, maxTokens }) {
    return {
      url: `${ai.apiBase}/v1/messages`,
      headers: { "x-api-key": ai.apiKey, "anthropic-version": API_VERSION },
      body: { model: ai.model, max_tokens: maxTokens, system, messages: [{ role: "user", content }],
        tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }], tool_choice: { type: "tool", name: tool.name } }
    };
  },

  // "credit" when the account has no credit left, "rejected" for another refused request
  refusal(status, body) {
    if (status === 400) return /credit|billing/i.test(body?.error?.message || "") ? "credit" : "rejected";
    return null;
  },

  result(data, tool) {
    const call = (data?.content || []).find(block => block.type === "tool_use" && block.name === tool.name);
    return call?.input;
  }
};
