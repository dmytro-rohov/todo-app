import unittest,runpy,json,subprocess,tempfile,os,shutil
from pathlib import Path
P=Path(__file__).resolve().parent
M=runpy.run_path(str(P/'image-validation.py'))
class Images(unittest.TestCase):
 def test_official_aliases(self):
  for name,digest in M['APPROVED'].items():
   for alias in [name,'docker.io/library/'+name]:
    M['validate']('docker.io/library/'+name+'@'+digest,{'Os':'linux','Architecture':'amd64','RepoDigests':[alias+'@'+digest]})
 def test_rejections(self):
  digest=M['APPROVED']['postgres'];good={'Os':'linux','Architecture':'amd64','RepoDigests':['postgres@'+digest]}
  for bad in [{**good,'RepoDigests':[]},{**good,'RepoDigests':['attacker/postgres@'+digest]},{**good,'RepoDigests':['postgres@sha256:'+'0'*64]},{**good,'Architecture':'arm64'},{**good,'Os':'windows'},{'Id':'sha256:'+'a'*64}]:
   with self.assertRaises(ValueError):M['validate']('postgres@'+digest,bad)
  with self.assertRaises(ValueError):M['validate']('sha256:'+'a'*64,good)
 def test_shared_shell_contract_without_docker(self):
  with tempfile.TemporaryDirectory() as temp:
   fake=Path(temp)/'docker';fake.write_text('#!/bin/sh\nprintf \'%s\\n\' "$INSPECT_JSON"\n');fake.chmod(0o700)
   digest=M['APPROVED']['postgres'];env=dict(os.environ,PATH=temp+':'+os.environ['PATH'],PACKAGE_DIR=str(P),INSPECT_JSON=json.dumps([{'Os':'linux','Architecture':'amd64','RepoDigests':['postgres@'+digest]}]))
   for entry in ['acceptance.sh','smoke.sh']:
    self.assertIn('image-validation.sh',(P/entry).read_text())
    result=subprocess.run(['bash','-c','source "$PACKAGE_DIR/image-validation.sh"; check_image "$1"','test','docker.io/library/postgres@'+digest],env=env,capture_output=True)
    self.assertEqual(result.returncode,0,result.stderr)
 def test_inspect_failure_is_not_swallowed(self):
  with tempfile.TemporaryDirectory() as temp:
   fake=Path(temp)/'docker';fake.write_text('#!/bin/sh\nexit 9\n');fake.chmod(0o700)
   env=dict(os.environ,PATH=temp+':'+os.environ['PATH'],PACKAGE_DIR=str(P))
   self.assertNotEqual(subprocess.run(['bash','-c','source "$PACKAGE_DIR/image-validation.sh"; check_image postgres@'+M['APPROVED']['postgres']],env=env,capture_output=True).returncode,0)
class ExportedPackage(unittest.TestCase):
 def test_helpers_work_after_export_without_repo(self):
  with tempfile.TemporaryDirectory() as directory:
   package=Path(directory)/'package';package.mkdir()
   for name in ['image-validation.py','image-validation.sh']:shutil.copyfile(P/name,package/name)
   digest=M['APPROVED']['postgres']
   data=json.dumps([{'Os':'linux','Architecture':'amd64','RepoDigests':['postgres@'+digest]}])
   result=subprocess.run(['python3',str(package/'image-validation.py'),'docker.io/library/postgres@'+digest],input=data,text=True,capture_output=True,cwd=directory)
   self.assertEqual(result.returncode,0,result.stderr)
unittest.main()
