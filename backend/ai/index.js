// AI behind one call: structured(ai, { system, content, tool }) returns a JSON object of tool.schema, whichever
// provider answers. The rest of Tasks (mail proposals, briefs, task routing) never talks to a provider directly.
// A provider is one file in ./providers: { label, apiBase, defaultModel, request(), refusal(), result() }.
//
// Settings (deploy/app.env):
//   AI_PROVIDER  anthropic (default) | openai (also any OpenAI-compatible API with AI_API_BASE)
//   AI_API_KEY   the provider's key (ANTHROPIC_API_KEY / OPENAI_API_KEY are read too)
//   AI_MODEL     the model id (ANTHROPIC_MODEL is read too); anthropic defaults to claude-sonnet-5-5
//   AI_API_BASE  optional https base URL of an OpenAI-compatible service
//   AI_LABEL     optional name shown in the app (e.g. "Mistral")
const PROVIDERS = { anthropic: require("./providers/anthropic"), openai: require("./providers/openai") };
const TIMEOUT_MS = 90000;

class AiError extends Error {}

// Returns { provider, label, apiKey, model, apiBase } or null (AI off); problems go to errors.
function loadAi(env, errors, { isProduction }) {
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
  else if (!/^[A-Za-z0-9._:/-]{2,100}$/.test(model)) errors.push("AI_MODEL must be a model id, e.g. claude-sonnet-5-5");
  let apiBase = provider.apiBase;
  if (env.AI_API_BASE) {
    if (!/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(env.AI_API_BASE)) errors.push("AI_API_BASE must be an https:// URL");
    else apiBase = env.AI_API_BASE.replace(/\/+$/, "");
  }
  // Local testing only (a fake provider API): never in production.
  const devBase = env.AI_DEV_BASE || env.ANTHROPIC_DEV_BASE;
  if (!isProduction && devBase) apiBase = devBase;
  const label = (env.AI_LABEL || "").trim().slice(0, 40) || (env.AI_API_BASE && name === "openai" ? "AI (API zgodne z OpenAI)" : provider.label);
  return { provider: name, label, apiKey, model, apiBase };
}

const MESSAGES = {
  key: "Klucz API AI jest nieprawidłowy.",
  limit: "Limit zapytań do AI: spróbuj za chwilę.",
  credit: "Brak środków na koncie API AI.",
  rejected: "AI odrzuciło zapytanie.",
  down: "AI nie odpowiada. Spróbuj za chwilę.",
  empty: "AI nie zwróciło odpowiedzi."
};

// tool: { name, description, schema } (JSON Schema of the answer)
async function structured(ai, { system, content, tool, maxTokens = 2000, fetchImpl = fetch }) {
  const provider = PROVIDERS[ai.provider || "anthropic"];
  const { url, headers, body } = provider.request(ai, { system, content, tool, maxTokens });
  let response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AiError(MESSAGES.down);
  }
  if (response.status === 401 || response.status === 403) throw new AiError(MESSAGES.key);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const refusal = provider.refusal(response.status, error);
    if (refusal) throw new AiError(MESSAGES[refusal]);
    throw new AiError(response.status === 429 ? MESSAGES.limit : MESSAGES.down);
  }
  const input = provider.result(await response.json().catch(() => null), tool);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AiError(MESSAGES.empty);
  return input;
}

module.exports = { loadAi, structured, AiError, PROVIDERS };
