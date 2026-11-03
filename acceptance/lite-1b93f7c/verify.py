#!/usr/bin/env python3
import hashlib,json,subprocess,sys
from pathlib import Path
package=Path(__file__).resolve().parent
source=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
m=json.loads((package/'source-manifest.json').read_text())
assert m['commit']=='1b93f7c228cacc569915f00a3b1258da68cc0926'
assert subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()==m['commit']
assert subprocess.check_output(['git','-C',str(source),'diff','HEAD','--name-only'],text=True).strip()==''
for f in m['files']:
 p=Path(f['path']); assert not p.is_absolute() and '..' not in p.parts
 assert hashlib.sha256((source/p).read_bytes()).hexdigest()==f['sha256'],str(p)
print('PASS source manifest:',m['commit'],len(m['files']),'files')
