# AI in Mytko Tasks (any provider)

Tasks uses AI for three things:
- task proposals from an e-mail (Poczta);
- meeting briefs;
- routing tasks to the Mytko Workflow ToDo (`WORKFLOW-TODO.md`).

None of them talks to a provider directly. They call one function, `structured(ai, { system, content, tool })` in
`backend/ai/index.js`. It returns a JSON object of `tool.schema`, whichever provider answers, and the callers validate
it again.

## Providers

| `AI_PROVIDER` | API | Notes |
| --- | --- | --- |
| `anthropic` (default) | Anthropic Messages, forced tool use | Claude; `AI_MODEL` defaults to `claude-sonnet-5-5` |
| `openai` | Chat Completions, forced function call | OpenAI; `AI_MODEL` is required. With `AI_API_BASE` it also works with OpenAI-compatible services: OpenRouter, Mistral, Groq, a local Ollama or vLLM server |

Adding a provider means one file in `backend/ai/providers/` plus one line in `PROVIDERS` (`backend/ai/index.js`). The
file provides:
- `label`, `apiBase`, `defaultModel`;
- `request(ai, { system, content, tool, maxTokens })` → `{ url, headers, body }`;
- `refusal(status, errorBody)` → `"credit"` / `"rejected"` / `null`;
- `result(responseJson, tool)` → the answer object.

Errors read the same for every provider ("Brak środków na koncie API AI.", "Klucz API AI jest nieprawidłowy.", …).

## Settings (`deploy/app.env`)

| Variable | |
| --- | --- |
| `AI_PROVIDER` | `anthropic` or `openai` |
| `AI_API_KEY` | the provider's key. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are read too. Without a key, AI is off |
| `AI_MODEL` | model id. `ANTHROPIC_MODEL` is read too |
| `AI_API_BASE` | optional `https://` base of an OpenAI-compatible API |
| `AI_LABEL` | optional name shown in Porządek → AI i Workflow (e.g. `Mistral`) |

Examples:

```
# Claude (as today)
AI_API_KEY=sk-ant-…

# OpenAI
AI_PROVIDER=openai
AI_API_KEY=sk-…
AI_MODEL=<model id>

# Mistral through its OpenAI-compatible API
AI_PROVIDER=openai
AI_API_BASE=https://api.mistral.ai
AI_API_KEY=…
AI_MODEL=mistral-large-latest
AI_LABEL=Mistral
```

In the app, **Porządek → AI i Workflow** shows the provider and model, and turns all AI on or off (e.g. when the credit
runs out). Tests: `backend/test/ai.test.js`, and `e2e/ui-workflow-ai.mjs` with `AI=1`, or with
`AI=1 AI_PROVIDER=openai` for the OpenAI format.
