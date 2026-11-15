// AI behind one call, for every Mytko app (from Mytko Tasks' backend/ai, 0.10.0): structured(ai, { system, content, tool })
// returns a JSON object of tool.schema, whichever provider answers. Apps never talk to a provider directly, and AI is
// always optional: without a key loadAi() returns null and the app works without it (the owner's on/off switch).
// A provider is one file in ./providers: { label, apiBase, defaultModel, request(), refusal(), result() }.
//
// Plain fetch on purpose: the kit adds no production dependency (AGENTS.md), and the same call serves OpenAI-compatible
// services. Errors are English with a code (AiError.code: key | limit | credit | rejected | refused | down | empty) for
// the app to show in its own words.
//
// Settings (the app's environment):
//   AI_PROVIDER  anthropic (default) | openai (also any OpenAI-compatible API with AI_API_BASE)
//   AI_API_KEY   the provider's key (ANTHROPIC_API_KEY / OPENAI_API_KEY are read too); none: AI is off
//   AI_MODEL     the model id (ANTHROPIC_MODEL is read too); anthropic defaults to claude-opus-5-5
//   AI_EFFORT    anthropic only: low | medium | high | xhigh | max (default: the model's own)
//   AI_API_BASE  optional https base URL of an OpenAI-compatible service
//   AI_LABEL     optional name shown in the app (e.g. "Mistral")
const PROVIDERS = { anthropic: require("./providers/anthropic"), openai: require("./providers/openai") };
const TIMEOUT_MS = 90000;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

const MESSAGES = {
  key: "The AI provider refused the API key",
  limit: "Too many AI requests, try again in a moment",
  credit: "The AI account has no credit left",
  rejected: "The AI provider rejected the request",
  refused: "The AI declined to answer this request",
  down: "The AI provider does not answer, try again in a moment",
  empty: "The AI gave no usable answer"
};
const fail = code => new AiError(code, MESSAGES[code]);

// Returns { provider, label, apiKey, model, apiBase, effort } or null (AI off); problems go to errors.
function loadAi(env, errors, { isProduction = true } = {}) {
  const name = (env.AI_PROVIDER || "anthropic").toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    errors.push(`AI_PROVIDER must be one of: ${Object.keys(PROVIDERS).join(", ")}`);
    return null;
  }
  const apiKey = env.AI_API_KEY || (name === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY);
  if (!apiKey) return null;
  const model = env.AI_MODEL || (name === "anthropic" ? env.ANTHROPIC_MODEL : "") || provider.defaultModel;
  if (!model) errors.push(`AI_MODEL is required for AI_PROVIDER=${name}`);
  else if (!/^[A-Za-z0-9._:/-]{2,100}$/.test(model)) errors.push("AI_MODEL must be a model id, e.g. claude-opus-5-5");
  const effort = env.AI_EFFORT || null;
  if (effort && !EFFORTS.includes(effort)) errors.push(`AI_EFFORT must be one of: ${EFFORTS.join(", ")}`);
  let apiBase = provider.apiBase;
  if (env.AI_API_BASE) {
    if (!/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(env.AI_API_BASE)) errors.push("AI_API_BASE must be an https:// URL");
    else apiBase = env.AI_API_BASE.replace(/\/+$/, "");
  }
  // Local testing only (a fake provider API): never in production.
  const devBase = env.AI_DEV_BASE || env.ANTHROPIC_DEV_BASE;
  if (!isProduction && devBase) apiBase = devBase;
  const label = (env.AI_LABEL || "").trim().slice(0, 40) || (env.AI_API_BASE && name === "openai" ? "AI (OpenAI-compatible API)" : provider.label);
  return { provider: name, label, apiKey, model, apiBase, effort };
}

// Whether value matches the JSON Schema subset tools use: type (one or a list, "integer" a whole number), enum, required,
// properties with additionalProperties: false, items, minimum/maximum, minLength/maxLength, minItems/maxItems. A provider
// may not enforce the schema (OpenAI-compatible services, a model answering loosely), so every answer is checked.
function matches(schema, value) {
  if (!schema || typeof schema !== "object") return true;
  const types = schema.type === undefined ? null : [].concat(schema.type);
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (types && !types.some(type => type === kind || (type === "integer" && Number.isInteger(value)) || (type === "number" && kind === "number" && Number.isFinite(value)))) return false;
  if (schema.enum && !schema.enum.some(item => item === value)) return false;
  if (kind === "number") {
    if (!Number.isFinite(value)) return false;
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }
  if (kind === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
  }
  if (kind === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every(item => matches(schema.items, item))) return false;
  }
  if (kind === "object") {
    const properties = schema.properties || {};
    if ((schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) { if (!matches(properties[key], item)) return false; }
      else if (schema.additionalProperties === false) return false;
    }
  }
  return true;
}

// Pictures sent with the text (0.12.0): JPEG, PNG, WebP or GIF, base64, each at most MAX_IMAGE_BYTES (a phone photo
// made small first), at most MAX_IMAGES. Anything else is refused before any request (code "rejected").
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
function checkImages(images) {
  if (!Array.isArray(images) || images.length > MAX_IMAGES) return false;
  return images.every(image => image && IMAGE_TYPES.includes(image.mediaType) && typeof image.data === "string"
    && /^[A-Za-z0-9+/]+={0,2}$/.test(image.data) && image.data.length * 0.75 <= MAX_IMAGE_BYTES);
}

// tool: { name, description, schema } (JSON Schema of the answer; with additionalProperties: false it is sent strict).
// images: [{ mediaType, data }] pictures the text is about (e.g. a receipt); each provider gets them its own way.
// effort: this call's own (anthropic), e.g. "low" for a quick classification.
async function structured(ai, { system, content, tool, images = [], maxTokens = 4000, effort = null, fetchImpl = fetch }) {
  const provider = PROVIDERS[ai.provider || "anthropic"];
  if (!checkImages(images)) throw fail("rejected");
  const { url, headers, body } = provider.request(ai, { system, content, tool, images, maxTokens, effort: effort || ai.effort || null });
  let response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw fail("down");
  }
  if (response.status === 401 || response.status === 403) throw fail("key");
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const refusal = provider.refusal(response.status, error);
    if (refusal) throw fail(refusal);
    throw fail(response.status === 429 ? "limit" : "down");
  }
  const data = await response.json().catch(() => null);
  if (provider.declined && provider.declined(data)) throw fail("refused");
  const input = provider.result(data, tool);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("empty");
  // an answer outside the tool's schema is no usable answer
  if (!matches(tool.schema, input)) throw fail("empty");
  return input;
}

// The models the provider offers for choosing ([{ id, label, cost: low | medium | high }]; none for an OpenAI-compatible
// service, whose models differ per service: there AI_MODEL alone decides).
function aiModels(ai) {
  return (ai && PROVIDERS[ai.provider || "anthropic"]?.models) || [];
}

// ai with another model, when it is one of aiModels(ai) (e.g. the administrator's choice kept by the app); otherwise ai
// as it is (the AI_MODEL setting or the provider's default).
function withModel(ai, model) {
  if (!ai || !model || model === ai.model || !aiModels(ai).some(item => item.id === model)) return ai;
  return { ...ai, model };
}

module.exports = { loadAi, structured, aiModels, withModel, matchesSchema: matches, AI_IMAGE_TYPES: IMAGE_TYPES, AI_MAX_IMAGES: MAX_IMAGES, AI_MAX_IMAGE_BYTES: MAX_IMAGE_BYTES, AiError, AI_PROVIDERS: PROVIDERS, AI_MESSAGES: MESSAGES };
