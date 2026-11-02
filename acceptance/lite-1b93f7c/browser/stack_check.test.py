#!/usr/bin/env python3
"""stack_check.py against a fake `docker` CLI on PATH; no daemon is used."""
import json, os, stat, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = 'tasks-validation-1-2-3'
RUN = 'tasks-lite-1-2'
BASE = 'http://127.0.0.1:3101'
SHA = '1b93f7c228cacc569915f00a3b1258da68cc0926'

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
state = json.load(open(os.environ['FAKE_DOCKER_STATE']))
a = sys.argv[1:]
def out(v): print(v); sys.exit(0)
if a[:2] == ['ps', '-aq']: out('\n'.join(state['containers']))
if a[:3] == ['volume', 'ls', '-q']: out('\n'.join(state['volumes']))
if a[:3] == ['network', 'ls', '-q']: out('\n'.join(state['networks']))
if a[:2] == ['ps', '-q']:
    f = a[3]
    if f.startswith('publish='): out('\n'.join(state['publishers']))
    out('\n'.join(state['app_ids']))
if a[0] in ('container', 'volume', 'network', 'image') and a[1] == 'inspect': out(json.dumps([state['inspect'][a[2]]]))
if a[0] == 'port': out(state['port'])
sys.exit(1)
'''


def labels(project=PROJECT, run=RUN):
    return {'com.docker.compose.project': project, 'dev.mytko.acceptance': run}


def good_state():
    return {
        'containers': ['app1', 'db1'], 'volumes': ['vol1'], 'networks': ['net1'],
        'app_ids': ['app1'], 'publishers': ['app1'], 'port': '127.0.0.1:3101',
        'inspect': {
            'app1': {'Config': {'Labels': labels(), 'Env': ['DATABASE_URL=postgres://secret', f'PUBLIC_ORIGIN={BASE}']},
                     'State': {'Status': 'running'}, 'Image': 'sha256:img'},
            'db1': {'Config': {'Labels': labels()}},
            'vol1': {'Labels': labels()}, 'net1': {'Labels': labels()},
            'sha256:img': {'Config': {'Labels': {'org.opencontainers.image.revision': SHA}}},
        },
    }


class StackCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        bin_dir = Path(self.tmp.name) / 'bin'
        bin_dir.mkdir()
        docker = bin_dir / 'docker'
        docker.write_text(FAKE_DOCKER)
        docker.chmod(stat.S_IRWXU)
        self.state_file = Path(self.tmp.name) / 'state.json'
        self.env = {'PATH': f'{bin_dir}:{os.environ["PATH"]}', 'FAKE_DOCKER_STATE': str(self.state_file)}

    def tearDown(self):
        self.tmp.cleanup()

    def run_check(self, state, project=PROJECT, run=RUN, base=BASE):
        self.state_file.write_text(json.dumps(state))
        return subprocess.run([sys.executable, '-I', str(HERE / 'stack_check.py'), project, run, base],
                              env=self.env, capture_output=True, text=True)

    def test_owned_running_isolated_stack_passes_without_leaking_env(self):
        r = self.run_check(good_state())
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)['status'], 'PASS')
        self.assertNotIn('secret', r.stdout + r.stderr)

    def assert_blocked(self, state, message, **kwargs):
        r = self.run_check(state, **kwargs)
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn(message, r.stderr)
        self.assertNotIn('secret', r.stdout + r.stderr)

    def test_production_origin_stack_is_rejected(self):
        s = good_state()
        s['inspect']['app1']['Config']['Env'] = ['DATABASE_URL=postgres://secret', 'PUBLIC_ORIGIN=https://task.mytko.dev']
        self.assert_blocked(s, 'PUBLIC_ORIGIN')

    def test_public_binding_is_rejected(self):
        s = good_state(); s['port'] = '0.0.0.0:3101'
        self.assert_blocked(s, 'loopback')

    def test_foreign_listener_is_rejected(self):
        s = good_state(); s['publishers'] = ['app1', 'other']
        self.assert_blocked(s, 'Another container')

    def test_wrong_image_is_rejected(self):
        s = good_state(); s['inspect']['sha256:img']['Config']['Labels']['org.opencontainers.image.revision'] = 'f' * 40
        self.assert_blocked(s, 'exact candidate')

    def test_stopped_app_is_rejected(self):
        s = good_state(); s['inspect']['app1']['State']['Status'] = 'exited'
        self.assert_blocked(s, 'not running')

    def test_foreign_resource_in_scope_is_rejected(self):
        s = good_state(); s['inspect']['vol1']['Labels'] = labels(run='tasks-lite-other')
        self.assert_blocked(s, 'foreign or unlabeled')

    def test_invalid_scope_or_target_is_rejected(self):
        self.assert_blocked(good_state(), 'ownership scope', project='prod-stack')
        self.assert_blocked(good_state(), 'loopback http origin', base='https://task.mytko.dev')


if __name__ == '__main__':
    unittest.main()
