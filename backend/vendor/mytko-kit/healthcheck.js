// Container HEALTHCHECK: exits 0 only when /readyz reports ready. Runs when loaded (the app's
// backend/scripts/healthcheck.js requires it; that path stays stable for the Dockerfile and compose files). No
// dependencies: the probe runs every few seconds.
const port = process.env.PORT || 3000;

fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(3000) })
  .then(res => process.exit(res.ok ? 0 : 1))
  .catch(() => process.exit(1));
