// Anthropic Messages API (Claude). Current models refuse a forced tool_choice ("tool"/"any" return a 400), so the
// answer tool is offered with tool_choice "auto", sent strict when its schema allows it, and the system prompt asks for
// exactly that one call. A "refusal" stop reason is the model declining (no tool call to read). Refusal fallbacks:
// the server-side "default" mode lets a declined request be answered by a fallback model Anthropic picks.
const API_VERSION = "2023-06-01";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

module.exports = {
  label: "Claude (Anthropic)",
  apiBase: "https://api.anthropic.com",
  defaultModel: "claude-opus-5-5",

  request(ai, { system, content, tool, maxTokens, effort }) {
    const strict = tool.schema && tool.schema.additionalProperties === false;
    const body = {
      model: ai.model,
      max_tokens: maxTokens,
      system: `${system}\n\nAnswer only by calling the tool "${tool.name}" exactly once.`,
      messages: [{ role: "user", content }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema, ...(strict ? { strict: true } : {}) }],
      tool_choice: { type: "auto" },
      fallbacks: "default"
    };
    if (effort) body.output_config = { effort };
    return { url: `${ai.apiBase}/v1/messages`, headers: { "x-api-key": ai.apiKey, "anthropic-version": API_VERSION, "anthropic-beta": FALLBACK_BETA }, body };
  },

  // "credit" when the account has no credit left, "rejected" for another refused request
  refusal(status, body) {
    if (status === 400) return /credit|billing/i.test(body?.error?.message || "") ? "credit" : "rejected";
    return null;
  },

  declined(data) {
    return data?.stop_reason === "refusal";
  },

  result(data, tool) {
    const call = (data?.content || []).find(block => block.type === "tool_use" && block.name === tool.name);
    return call?.input;
  }
};
