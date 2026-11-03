#!/usr/bin/env python3
"""Offline validation of official pinned image inspect data; never pulls images."""
import json,re,sys
APPROVED={
 'node':'sha256:a43f7fc3e52e87d12a905f46eea0275def84ca8f2981a5b53fed44d7fb398ee0',
 'postgres':'sha256:e4cb93687b062cd25a0e8f672d85a7708235009d70d31f8a7698d9370092a9c4'}
def parse(ref):
 if not isinstance(ref,str) or ref.count('@')!=1:raise ValueError('Repository digest required')
 repo,digest=ref.split('@')
 aliases={alias:name for name in APPROVED for alias in [name,'docker.io/library/'+name]}
 if repo not in aliases or not re.fullmatch(r'sha256:[a-f0-9]{64}',digest):raise ValueError('Unapproved repository or digest syntax')
 name=aliases[repo]
 if digest!=APPROVED[name]:raise ValueError('Unapproved digest')
 return name,digest
def matches(expected,actual):
 try:return parse(expected)==parse(actual)
 except (ValueError,TypeError):return False
def validate(expected,inspect):
 parse(expected)
 if inspect.get('Os')!='linux' or inspect.get('Architecture')!='amd64':raise ValueError('Required platform linux/amd64')
 refs=inspect.get('RepoDigests')
 if not isinstance(refs,list) or not any(matches(expected,ref) for ref in refs):raise ValueError('Approved RepoDigest missing')
if __name__=='__main__':
 try:
  if sys.argv[1]=='--match':sys.exit(0 if matches(sys.argv[2],sys.argv[3]) else 1)
  data=json.load(sys.stdin)
  if not isinstance(data,list) or len(data)!=1:raise ValueError('Expected one inspect result')
  validate(sys.argv[1],data[0])
 except (ValueError,TypeError,KeyError,IndexError):print('Image validation failed',file=sys.stderr);sys.exit(1)
