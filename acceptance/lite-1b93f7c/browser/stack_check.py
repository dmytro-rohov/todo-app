#!/usr/bin/env python3
"""Read-only proof that an already running stack may receive browser-only QA.

Checks ownership labels, exact candidate image, running state, loopback-only
publication, sole listener on the port and that PUBLIC_ORIGIN equals the
browser origin (otherwise every same-origin browser write is rejected by CSRF).
Never starts, stops or removes anything; never prints container environment.
"""
import json, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ownership import resources  # noqa: E402

EXPECTED_SOURCE_SHA = '1b93f7c228cacc569915f00a3b1258da68cc0926'


class StackError(ValueError):
    pass


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True)


def check(project, run, base):
    if not project.startswith('tasks-validation-') or not run.startswith('tasks-lite-'):
        raise StackError('Invalid ownership scope')
    match = re.fullmatch(r'http://127\.0\.0\.1:(\d{2,5})', base)
    if not match:
        raise StackError('Browser target must be a loopback http origin')
    port = match.group(1)
    resources(project, run)  # raises on any foreign/unlabeled resource in scope
    ids = docker('ps', '-q', '--filter', f'label=com.docker.compose.project={project}',
                 '--filter', 'label=com.docker.compose.service=app').split()
    if len(ids) != 1:
        raise StackError(f'Expected exactly one running app container, found {len(ids)}')
    app = json.loads(docker('container', 'inspect', ids[0]))[0]
    labels = app.get('Config', {}).get('Labels') or {}
    if labels.get('dev.mytko.acceptance') != run or labels.get('com.docker.compose.project') != project:
        raise StackError('App container ownership labels do not match')
    if app.get('State', {}).get('Status') != 'running':
        raise StackError('App container is not running')
    image = json.loads(docker('image', 'inspect', app['Image']))[0]
    if (image.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') != EXPECTED_SOURCE_SHA:
        raise StackError('App image is not the exact candidate')
    published = [line.strip() for line in docker('port', ids[0], '3000/tcp').splitlines() if line.strip()]
    if published != [f'127.0.0.1:{port}']:
        raise StackError('App must be published only on the loopback browser port')
    listeners = docker('ps', '-q', '--filter', f'publish={port}').split()
    if listeners != ids:
        raise StackError('Another container publishes the browser port')
    env = app.get('Config', {}).get('Env') or []
    origins = [e.split('=', 1)[1] for e in env if e.startswith('PUBLIC_ORIGIN=')]
    if origins != [base]:
        raise StackError('PUBLIC_ORIGIN of the running stack differs from the browser origin; start a new stack')
    return {'status': 'PASS', 'project': project, 'run': run, 'container': ids[0][:12], 'origin': base}


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('usage: stack_check.py PROJECT RUN E2E_BASE')
    try:
        print(json.dumps(check(*sys.argv[1:])))
    except (StackError, ValueError, subprocess.CalledProcessError) as error:
        print(f'BLOCKED stack check: {error}', file=sys.stderr)
        raise SystemExit(3)
