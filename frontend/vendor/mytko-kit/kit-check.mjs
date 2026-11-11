// Mytko Kit: is this vendored copy exactly what the kit's sync wrote? Shipped inside every vendored part
// (<app>/frontend/vendor/mytko-kit, <app>/backend/vendor/mytko-kit) next to mytko-kit.json, the manifest sync writes:
// the kit's version and commit and the sha256 of every file. An app's test calls checkVendored(); a file edited by
// hand, added or removed makes it fail. Plain Node, no dependencies.
//
//   node kit-check.mjs [dir]      exit 1 and list the problems when the copy differs
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST = "mytko-kit.json";

export function sha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

// Every file under dir, as forward-slash paths relative to it.
export function listFiles(dir) {
  const out = [];
  const walk = current => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path).split(sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

// { ok, problems: [text], manifest } — problems name each file that is changed, missing or not the kit's.
export function checkVendored(dir) {
  const problems = [];
  const manifestPath = join(dir, MANIFEST);
  if (!existsSync(manifestPath)) return { ok: false, problems: [`${MANIFEST} is missing in ${dir}: run the kit's tools/sync.mjs`], manifest: null };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return { ok: false, problems: [`${MANIFEST} is not valid JSON`], manifest: null };
  }
  if (!manifest || typeof manifest.files !== "object" || !manifest.commit) return { ok: false, problems: [`${MANIFEST} has no files or commit`], manifest };
  const present = new Set(listFiles(dir).filter(file => file !== MANIFEST));
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (!present.has(file)) { problems.push(`missing: ${file}`); continue; }
    present.delete(file);
    if (sha256(readFileSync(join(dir, file))) !== hash) problems.push(`changed: ${file}`);
  }
  for (const file of present) problems.push(`not from the kit: ${file}`);
  return { ok: problems.length === 0, problems, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || fileURLToPath(new URL(".", import.meta.url));
  const { ok, problems, manifest } = checkVendored(dir);
  if (!ok) {
    console.error(`Mytko Kit copy in ${dir} differs from its manifest (never edit vendor/mytko-kit; change the kit and sync):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`Mytko Kit ${manifest.version} (${manifest.commit.slice(0, 12)}) ${manifest.part}: ${Object.keys(manifest.files).length} files as synced`);
}
