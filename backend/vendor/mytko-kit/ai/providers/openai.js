// OpenAI Chat Completions with a forced function call; the same request shape is served by many OpenAI-compatible
// APIs (set AI_API_BASE: OpenRouter, Mistral, Groq, a local Ollama/vLLM server, …).
module.exports = {
  label: "OpenAI",
  apiBase: "https://api.openai.com",
  // no default: the model is chosen explicitly with AI_MODEL
  defaultModel: null,

  request(ai, { system, content, tool }) {
    return {
      url: `${ai.apiBase}/v1/chat/completions`,
      headers: { authorization: `Bearer ${ai.apiKey}` },
      // no token limit: the answer is one small function call, and limit parameters differ between models and services
      body: { model: ai.model, messages: [{ role: "system", content: system }, { role: "user", content }],
        tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.schema } }],
        tool_choice: { type: "function", function: { name: tool.name } } }
    };
  },

  refusal(status, body) {
    const error = body?.error || {};
    if (status === 429 && (error.code === "insufficient_quota" || /quota|billing/i.test(error.message || ""))) return "credit";
    if (status === 402) return "credit";
    if (status === 400) return "rejected";
    return null;
  },

  result(data, tool) {
    const call = (data?.choices?.[0]?.message?.tool_calls || []).find(c => c?.function?.name === tool.name);
    if (!call) return undefined;
    try { return JSON.parse(call.function.arguments); } catch { return undefined; }
  }
};
