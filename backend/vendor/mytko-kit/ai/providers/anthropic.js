// Anthropic Messages API (Claude). Current models refuse a forced tool_choice ("tool"/"any" return a 400), so the
// answer tool is offered with tool_choice "auto", sent strict when its schema allows it, and the system prompt asks for
// exactly that one call. A "refusal" stop reason is the model declining (no tool call to read). Refusal fallbacks:
// the server-side "default" mode lets a declined request be answered by a fallback model Anthropic picks.
const API_VERSION = "2023-06-01";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Strict tool use takes only part of JSON Schema: no number, string or array limits (minimum, maxLength, maxItems, …
// are a 400) and every object closed. The schema sent is a copy without them; structured() still checks each answer
// against the full schema (matchesSchema), the way Anthropic's own SDKs do it. A type list is sent as anyOf.
const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength",
  "pattern", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties"];
function strictSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const copy = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED.includes(key)) continue;
    if (key === "properties") copy.properties = Object.fromEntries(Object.entries(value).map(([name, item]) => [name, strictSchema(item)]));
    else if (key === "items") copy.items = strictSchema(value);
    else if (key === "anyOf" || key === "allOf") copy[key] = value.map(strictSchema);
    else copy[key] = value;
  }
  if (Array.isArray(copy.type)) {
    copy.anyOf = copy.type.map(type => ({ type }));
    delete copy.type;
  }
  if ((copy.type === "object" || copy.properties) && copy.additionalProperties === undefined) copy.additionalProperties = false;
  return copy;
}

// The models an app may offer its administrator (0.13.0), cheapest first; cost: what one call roughly costs compared
// with the others (the app says it in its own words). Haiku takes neither refusal fallbacks nor an effort: both are
// left out for it (any model id starting "claude-haiku-", also one set with AI_MODEL).
const MODELS = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", cost: "low" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", cost: "medium" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", cost: "high" }
];
const basic = model => /^claude-haiku-/.test(model);

module.exports = {
  strictSchema,
  label: "Claude (Anthropic)",
  apiBase: "https://api.anthropic.com",
  defaultModel: "claude-opus-5-5",
  models: MODELS,

  request(ai, { system, content, tool, images = [], maxTokens, effort }) {
    const strict = tool.schema && tool.schema.additionalProperties === false;
    const body = {
      model: ai.model,
      max_tokens: maxTokens,
      system: `${system}\n\nAnswer only by calling the tool "${tool.name}" exactly once.`,
      // pictures first, then the text about them
      messages: [{ role: "user", content: images.length
        ? [...images.map(image => ({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } })), { type: "text", text: content }]
        : content }],
      tools: [{ name: tool.name, description: tool.description, input_schema: strict ? strictSchema(tool.schema) : tool.schema, ...(strict ? { strict: true } : {}) }],
      tool_choice: { type: "auto" }
    };
    const headers = { "x-api-key": ai.apiKey, "anthropic-version": API_VERSION };
    if (!basic(ai.model)) {
      body.fallbacks = "default";
      headers["anthropic-beta"] = FALLBACK_BETA;
      if (effort) body.output_config = { effort };
    }
    return { url: `${ai.apiBase}/v1/messages`, headers, body };
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
