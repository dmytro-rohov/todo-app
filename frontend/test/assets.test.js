import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = readFileSync(join(frontendDir, "index.html"), "utf8");

test("index.html links the compiled stylesheet and the ES module entry point", () => {
  assert.match(indexHtml, /<link[^>]+rel="stylesheet"[^>]+href="\.\/dist\/style\.css"/);
  assert.match(indexHtml, /<script[^>]+type="module"[^>]+src="\.\/js\/main\.js"/);
  assert.ok(existsSync(join(frontendDir, "js", "main.js")));
});

test("the stylesheet source exists and builds into dist/ (ignored by Git)", () => {
  assert.ok(existsSync(join(frontendDir, "styles", "style.scss")));
  const pkg = JSON.parse(readFileSync(join(frontendDir, "package.json"), "utf8"));
  assert.match(pkg.scripts.build, /styles\/style\.scss dist\/style\.css/);
});

test("SCSS declares the cascade layer order once and avoids deprecated @import", () => {
  const style = readFileSync(join(frontendDir, "styles", "style.scss"), "utf8");
  const reset = readFileSync(join(frontendDir, "styles", "reset.scss"), "utf8");
  assert.match(style, /^@layer reset, base, components, main, utilities;$/m);
  assert.doesNotMatch(style, /@import/);
  assert.doesNotMatch(reset, /@layer/, "reset.scss is wrapped by style.scss; nesting creates reset.reset");
});

test("compiled stylesheet exists (run `npm run build` in frontend/)", (t) => {
  const css = join(frontendDir, "dist", "style.css");
  if (!existsSync(css)) {
    t.skip("frontend/dist/style.css not built yet");
    return;
  }
  const content = readFileSync(css, "utf8");
  assert.match(content, /@layer reset, base, components, main, utilities;/);
  assert.doesNotMatch(content, /@layer reset\s*\{\s*@layer reset/);
});

// Walk the native ES module graph from main.js and check every relative
// import resolves to a file that exports the imported names.
function collectExports(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  return names;
}

function collectImports(source) {
  const imports = [];
  for (const match of source.matchAll(/import\s*(?:\{([^}]*)\}\s*from\s*)?["']([^"']+)["']/g)) {
    const names = (match[1] || "")
      .split(",")
      .map(part => part.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);
    imports.push({ specifier: match[2], names });
  }
  return imports;
}

test("every module reachable from main.js resolves with matching named exports", () => {
  const seen = new Set();
  const queue = [join(frontendDir, "js", "main.js")];

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    for (const { specifier, names } of collectImports(source)) {
      assert.ok(specifier.startsWith("./") || specifier.startsWith("../"),
        `${file}: bare import "${specifier}" is not loadable without a bundler`);
      assert.ok(specifier.endsWith(".js"), `${file}: import "${specifier}" needs a .js extension`);

      const target = resolve(dirname(file), specifier);
      assert.ok(existsSync(target), `${file}: "${specifier}" does not exist`);

      const exported = collectExports(readFileSync(target, "utf8"));
      for (const name of names) {
        assert.ok(exported.has(name), `${file}: "${name}" is not exported by ${specifier}`);
      }
      queue.push(target);
    }
  }

  assert.ok(seen.size > 5, "module graph should include the app modules");
});

test("no API module hardcodes a localhost URL", () => {
  for (const name of ["http.js", "tasks.js", "categories.js"]) {
    const source = readFileSync(join(frontendDir, "js", "api", name), "utf8");
    assert.doesNotMatch(source, /localhost|127\.0\.0\.1/, `${name} hardcodes a local URL`);
  }
});
