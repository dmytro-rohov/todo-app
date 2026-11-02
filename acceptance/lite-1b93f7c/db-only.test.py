import unittest,runpy,os,json,subprocess
from pathlib import Path
from unittest.mock import patch
module=runpy.run_path(str(Path(__file__).with_name('db-only')),run_name='db_runner_test')
class Preflight(unittest.TestCase):
 def test_platform_and_digest(self):
  good={'Os':'linux','Architecture':'amd64','RepoDigests':[module['IMAGE']]}
  module['validate_image'](good)
  for bad in [{**good,'Os':'windows'},{**good,'Architecture':'arm64'},{**good,'RepoDigests':[]}]:
   with self.assertRaises(ValueError):module['validate_image'](bad)
 def test_approval(self):
  with patch.dict(os.environ,{},clear=True):
   with self.assertRaises(ValueError):module['execute'](Path('.'))
 def test_override(self):
  for key in ['DOCKER_HOST','DOCKER_CONTEXT','PGHOST','PGDATABASE','NODE_OPTIONS']:
   with patch.dict(os.environ,{key:'foreign'},clear=True):
    with self.assertRaises(ValueError):module['preflight'](Path('.'))
 def test_no_removal_or_pull(self):
  text=Path(__file__).with_name('db-only').read_text()
  self.assertNotIn("'docker','rm'",text);self.assertNotIn("'docker','pull'",text)
  self.assertIn('--pull=never',text);self.assertIn("'--internal'",text)
 def test_source_manifest_rejects_wrong_head(self):
  self.assertIn("m['commit']",Path(__file__).with_name('verify.py').read_text())
  self.assertEqual(module['IMAGE'],'docker.io/library/postgres@sha256:e4cb93687b062cd25a0e8f672d85a7708235009d70d31f8a7698d9370092a9c4')
unittest.main()
