// An app's assistant connector (0.10.0): the tools Mytko Assistant may use in this app ("add an expense", "add a task"),
// called server to server, never by a browser. The assistant acts as the app's administrator (its owner).
//
//   const connector = kit.createAssistantConnector({ tokenHash: config.assistant, owner: () => users.admin(), tools: [
//     { name: "finance.add_expense", description: "…", schema: { type: "object", additionalProperties: false, … },
//       run: async (input, { user }) => ({ summary: "…", undo: { entryId: 7 }, data: {…} }),
//       undo: async (handle, { user }) => "…" } ],
//     context: async ({ user }) => ({ categories: [...] }) });
//   app.use("/api/assistant", express.json({ limit: "10kb" }), connector);   // before requireUser: its own sign-in
//
//   GET  /api/assistant/tools    → { tools: [{ name, description, schema }], context }
//   POST /api/assistant/run      { tool, input } → { summary, undo: "<token>" | null, data }
//   POST /api/assistant/undo     { undo } → { summary }
//
// - Sign-in: Authorization: Bearer <ASSISTANT_TOKEN>; the app keeps only its SHA-256 (ASSISTANT_TOKEN_SHA256, config.js).
//   Without it every route answers 404, as if there were none.
// - Input: checked against the tool's schema (flat objects: string / integer / number / boolean, enum, min/max lengths
//   and values, required, no other keys) before run() sees it; the tool still validates its own rules.
// - Undo: what run() returns as undo is sealed (HMAC with the token's hash, 24 h): the assistant can only undo what it
//   did itself, recently, and the handle reaches the tool's undo() unchanged.
// - Errors: { message } in English; a tool's own refusal is an AssistantError (status 400/404/409, its message shown).
const crypto = require("node:crypto");

const loadExpress = () => require("express");

const TOOL_NAME = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/;
const UNDO_TTL_MS = 24 * 3600 * 1000;
const HASH = /^[a-f0-9]{64}$/;

class AssistantError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AssistantError";
    this.status = status;
  }
}

// ASSISTANT_TOKEN_SHA256 (config.js): null when the app has no connector.
function loadAssistant(env, errors) {
  const hash = (env.ASSISTANT_TOKEN_SHA256 || "").trim().toLowerCase();
  if (!hash) return null;
  if (!HASH.test(hash)) {
    errors.push("ASSISTANT_TOKEN_SHA256 must be the SHA-256 (64 hex characters) of the assistant's token");
    return null;
  }
  return Object.freeze({ tokenHash: hash });
}

function checkValue(spec, value, key) {
  const bad = message => new AssistantError(`${key}: ${message}`);
  if (spec.type === "string") {
    if (typeof value !== "string") throw bad("expected text");
    if (spec.minLength !== undefined && value.length < spec.minLength) throw bad(`at least ${spec.minLength} characters`);
    if (spec.maxLength !== undefined && value.length > spec.maxLength) throw bad(`at most ${spec.maxLength} characters`);
    if (spec.pattern && !new RegExp(spec.pattern).test(value)) throw bad("wrong format");
  } else if (spec.type === "integer" || spec.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (spec.type === "integer" && !Number.isInteger(value))) throw bad(`expected ${spec.type === "integer" ? "a whole number" : "a number"}`);
    if (spec.minimum !== undefined && value < spec.minimum) throw bad(`at least ${spec.minimum}`);
    if (spec.maximum !== undefined && value > spec.maximum) throw bad(`at most ${spec.maximum}`);
  } else if (spec.type === "boolean") {
    if (typeof value !== "boolean") throw bad("expected true or false");
  } else {
    throw bad("unsupported type");
  }
  if (spec.enum && !spec.enum.includes(value)) throw bad(`one of ${spec.enum.join(", ")}`);
}

// The input as the tool's (flat) schema allows it, or an AssistantError. An optional field sent as null counts as not
// given: it is left out of what the tool gets, so a tool never receives a value of a type its schema does not allow.
function checkInput(schema, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AssistantError("input: expected an object");
  const properties = schema.properties || {};
  const checked = {};
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(properties, key)) throw new AssistantError(`${key}: unknown field`);
    if (input[key] === null || input[key] === undefined) continue;
    checkValue(properties[key], input[key], key);
    checked[key] = input[key];
  }
  for (const key of schema.required || []) {
    if (checked[key] === undefined) throw new AssistantError(`${key}: required`);
  }
  return checked;
}

function seal(secret, payload, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + UNDO_TTL_MS })).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function unseal(secret, token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  return payload && typeof payload === "object" && payload.exp > now ? payload : null;
}

function bearerMatches(header, tokenHash) {
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{32,200})$/.exec(header || "");
  if (!match) return false;
  const given = crypto.createHash("sha256").update(match[1]).digest();
  return crypto.timingSafeEqual(given, Buffer.from(tokenHash, "hex"));
}

// config: config.assistant (loadAssistant) or null; owner(): the account the assistant acts as; context(): hints for the
// assistant (e.g. the category names), shown with the tool list.
function createAssistantConnector({ config, owner, tools = [], context = null, now = Date.now }) {
  const list = tools.map(tool => {
    if (!tool || !TOOL_NAME.test(tool.name) || typeof tool.description !== "string" || typeof tool.run !== "function"
        || !tool.schema || tool.schema.type !== "object" || tool.schema.additionalProperties !== false) {
      throw new Error("An assistant tool is { name: \"app.verb_noun\", description, schema: { type: \"object\", additionalProperties: false, … }, run }");
    }
    return tool;
  });
  if (new Set(list.map(tool => tool.name)).size !== list.length) throw new Error("Assistant tools must have different names");
  const byName = new Map(list.map(tool => [tool.name, tool]));
  const router = loadExpress().Router();

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!config) return res.status(404).json({ message: "Not found" });
    if (!bearerMatches(req.get("authorization"), config.tokenHash)) return res.status(401).json({ message: "Authentication required" });
    next();
  });

  const account = async () => {
    const user = await owner();
    if (!user) throw new AssistantError("The owner's account is not ready", 409);
    return user;
  };
  const answer = (res, error) => {
    if (error instanceof AssistantError) return res.status(error.status).json({ message: error.message });
    throw error;
  };

  router.get("/tools", async (req, res) => {
    const user = await account().catch(error => error);
    if (user instanceof Error) return answer(res, user);
    res.json({ tools: list.map(({ name, description, schema }) => ({ name, description, schema })), context: context ? await context({ user }) : null });
  });

  router.post("/run", async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== "object" || Object.keys(body).some(key => !["tool", "input"].includes(key))) throw new AssistantError("Invalid request");
      const tool = byName.get(body.tool);
      if (!tool) throw new AssistantError("Unknown tool", 404);
      const input = checkInput(tool.schema, body.input ?? {});
      const user = await account();
      const result = (await tool.run(input, { user })) || {};
      const undo = result.undo !== undefined && result.undo !== null && tool.undo ? seal(config.tokenHash, { tool: tool.name, handle: result.undo }, now()) : null;
      res.json({ summary: typeof result.summary === "string" ? result.summary : "", undo, data: result.data ?? null });
    } catch (error) {
      answer(res, error);
    }
  });

  router.post("/undo", async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== "object" || Object.keys(body).some(key => key !== "undo")) throw new AssistantError("Invalid request");
      const sealed = unseal(config.tokenHash, body.undo, now());
      const tool = sealed && byName.get(sealed.tool);
      if (!tool || !tool.undo) throw new AssistantError("This can no longer be undone", 409);
      const summary = await tool.undo(sealed.handle, { user: await account() });
      res.json({ summary: typeof summary === "string" ? summary : "" });
    } catch (error) {
      answer(res, error);
    }
  });

  return router;
}

module.exports = { createAssistantConnector, loadAssistant, AssistantError, checkInput, sealUndo: seal, unsealUndo: unseal };
