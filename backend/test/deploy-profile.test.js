'use strict';
// Guards the deploy profile against drift from the contract of the Mytko Workflow external deployment
// (src/mytko/domain/remote_deploy.py: parse_profile). This mirrors its rules; the authoritative check is
// that parser, which accepted the rendered profile when it was written (see docs/OVH-DEPLOY-ARCHITECTURE.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('../../scripts/render-deploy-profile.cjs');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'deploy', 'deploy-profile.template.json'), 'utf8');
const DIGEST = `sha256:${'a'.repeat(64)}`;
const profile = (digest = DIGEST) => JSON.parse(render(digest, TEMPLATE));
const OWNED = (namespace) => (name) => name === namespace || name.startsWith(`${namespace}-`) || name.startsWith(`${namespace}_`);

test('render fills only the image digest and refuses anything else', () => {
  assert.equal(profile().services[0].image, `ghcr.io/dmytro-rohov/mytko-tasks@${DIGEST}`);
  for (const bad of [undefined, '', 'latest', 'sha256:abc', `sha256:${'A'.repeat(64)}`, `${DIGEST}x`, 'mytko-tasks:a561813e']) {
    assert.throws(() => render(bad, TEMPLATE), /digest/, String(bad));
  }
});

test('images are pinned by digest inside the approved registry, never by tag', () => {
  const p = profile();
  for (const service of p.services) {
    assert.match(service.image, /^[a-z0-9][a-z0-9._/-]{0,199}@sha256:[0-9a-f]{64}$/);
    assert.ok(service.image.startsWith(`${p.registry}/`), 'outside the approved registry');
    assert.doesNotMatch(service.image, /:[A-Za-z0-9_.-]+@/, 'a tag next to the digest');
  }
});

test('every resource lives in the project namespace', () => {
  const p = profile();
  const owned = OWNED(p.namespace);
  assert.match(p.namespace, /^[a-z0-9][a-z0-9-]{1,40}$/);
  for (const name of [...p.networks, ...p.volumes, ...p.services.map((s) => s.name)]) assert.ok(owned(name), name);
  for (const service of p.services) for (const network of service.networks) assert.ok(p.networks.includes(network));
});

test('services are hardened exactly as the deploy contract requires', () => {
  for (const service of profile().services) {
    const [uid, gid] = service.user.split(':').map(Number);
    assert.ok(uid > 0 && (gid === undefined || gid > 0), 'non-root numeric user');
    assert.equal(service.read_only_rootfs, true);
    assert.ok(['unless-stopped', 'on-failure'].includes(service.restart));
    assert.deepEqual(service.volumes, [], 'the application stores nothing on disk');
    assert.ok(service.limits.cpus >= 0.05 && service.limits.cpus <= 16);
    assert.ok(service.limits.pids >= 16 && service.limits.pids <= 4096);
    for (const port of service.ports) {
      assert.equal(port.host_ip, '127.0.0.1', 'never published on a public interface');
      assert.ok(port.host_port >= 1024 && port.host_port <= 65535);
    }
    for (const ref of service.env_refs) assert.match(ref, /^[A-Z][A-Z0-9_]{0,63}$/);
  }
});

test('env refs are secret NAMES only: no value, URL or credential can sit in the profile', () => {
  const text = render(DIGEST, TEMPLATE);
  assert.doesNotMatch(text, /postgres(ql)?:\/\//i);
  assert.doesNotMatch(text, /\$scrypt|\$argon|password\s*[:=]/i);
  for (const ref of profile().services[0].env_refs) assert.doesNotMatch(ref, /[=:/@]/);
});

test('the route points at a loopback port published by the routed service', () => {
  const p = profile();
  const service = p.services.find((s) => s.name === p.route.service);
  assert.ok(service, 'route service is defined');
  assert.ok(service.ports.some((port) => port.host_port === p.route.port));
  assert.match(p.route.hostname, /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
});

test('the database is a named logical resource and migrations are declared', () => {
  const { database } = profile();
  assert.equal(database.required, true);
  assert.match(database.resource, /^[A-Za-z0-9_]+$/);
  assert.ok(['none', 'required'].includes(database.migration));
  const migrations = fs.readdirSync(path.join(ROOT, 'backend', 'migrations')).filter((f) => f.endsWith('.sql'));
  assert.equal(database.migration === 'required', migrations.length > 0);
});

test('the profile matches what the compose manifest and Dockerfile really run', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'deploy', 'compose.yaml'), 'utf8');
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const [service] = profile().services;
  assert.match(compose, /user: "1000:1000"/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, new RegExp(`127\\.0\\.0\\.1:\\$\\{APP_PORT:-${service.ports[0].host_port}\\}:${service.ports[0].container_port}`));
  assert.match(docker, new RegExp(`PORT=${service.ports[0].container_port}`));
  assert.match(docker, /HEALTHCHECK/);
  assert.match(compose, /service_completed_successfully/, 'schema first, code second');
});
