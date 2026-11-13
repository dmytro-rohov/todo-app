#!/usr/bin/env node
// Web Push for a Mytko app whose server is not Node (Mytko Workflow, Python): the very same encryption, signature,
// message rules and push-service list as push.js, one command per batch, so no app writes its own copy of them.
//
//   node push-cli.js keys [--prefix MYTKO_]    → <prefix>PUSH_VAPID_PUBLIC_KEY=… and <prefix>PUSH_VAPID_PRIVATE_KEY=…
//   node push-cli.js send < request.json       → {"results":[…]} on stdout
//
// request: { vapid: { publicKey, privateKey, subject? }, message: { title, body?, url?, tag?, badge? },
//            options?: { urgency?, ttl? }, devices: [{ endpoint, p256dh, auth }] (1–50) }
// results, one per device in its order: { result: "sent" | "gone" | "retry" | "failed" | "invalid", status?, after? }
//   gone: the push service no longer knows the device (forget it); retry: try again later (after: milliseconds, when
//   the service said); invalid: not a device push.js would ever post to (forget it).
// The private key comes on stdin only, never as an argument (process lists). No retries here: the caller has its own.
// Exit 0 with results, 2 for an unusable request (the reason on stderr, never the request).
const { allowedEndpoint, deliver, generateVapidKeys, pushMessage, vapidKeys, parseSubscription } = require("./push");

const MAX_DEVICES = 50;
const MAX_INPUT = 1024 * 1024;

async function readAll(stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stdin) {
    size += chunk.length;
    if (size > MAX_INPUT) throw new Error("the request is larger than 1 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function send(text, { fetchImpl = fetch } = {}) {
  let request;
  try {
    request = JSON.parse(text);
  } catch {
    throw new Error("the request is not JSON");
  }
  if (!request || typeof request !== "object") throw new Error("the request is not an object");
  const { vapid: raw = {}, message, options = {}, devices } = request;
  let vapid;
  try {
    vapid = vapidKeys(raw.publicKey, raw.privateKey, raw.subject || undefined);
  } catch {
    throw new Error("vapid is not a usable P-256 key pair");
  }
  const body = pushMessage(message);
  if (!Array.isArray(devices) || devices.length === 0 || devices.length > MAX_DEVICES) throw new Error(`devices: 1–${MAX_DEVICES}`);
  const urgency = ["very-low", "low", "normal", "high"].includes(options.urgency) ? options.urgency : "normal";
  const ttl = Number.isInteger(options.ttl) && options.ttl >= 0 && options.ttl <= 2419200 ? options.ttl : 86400;
  const payload = JSON.stringify(body);
  const results = await Promise.all(devices.map(async item => {
    const device = item && typeof item === "object" && allowedEndpoint(item.endpoint)
      ? parseSubscription({ endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } })
      : null;
    if (!device) return { result: "invalid" };
    const outcome = await deliver(device, payload, vapid, { fetchImpl, urgency, ttl, topic: body.tag || null });
    if (outcome.ok) return { result: "sent" };
    if (outcome.gone) return { result: "gone" };
    if (outcome.retryable) return outcome.after ? { result: "retry", status: outcome.status, after: outcome.after } : { result: "retry", status: outcome.status };
    return { result: "failed", status: outcome.status };
  }));
  return { results };
}

function keys(argv) {
  const at = argv.indexOf("--prefix");
  const prefix = at === -1 ? "" : argv[at + 1] || "";
  if (!/^([A-Z][A-Z0-9_]*_)?$/.test(prefix)) throw new Error("--prefix is upper-case letters, digits and _ ending in _ (e.g. MYTKO_)");
  const pair = generateVapidKeys();
  return [`${prefix}PUSH_VAPID_PUBLIC_KEY=${pair.publicKey}`, `${prefix}PUSH_VAPID_PRIVATE_KEY=${pair.privateKey}`];
}

async function main(argv = process.argv.slice(2), { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, fetchImpl = fetch } = {}) {
  try {
    if (argv[0] === "keys") {
      stdout.write(`${keys(argv.slice(1)).join("\n")}\n`);
      return 0;
    }
    if (argv[0] === "send") {
      stdout.write(`${JSON.stringify(await send(await readAll(stdin), { fetchImpl }))}\n`);
      return 0;
    }
    throw new Error("usage: node push-cli.js keys [--prefix MYTKO_] | send < request.json");
  } catch (error) {
    stderr.write(`push-cli: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; });
}

module.exports = { main, send };
