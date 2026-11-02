#!/usr/bin/env python3
import json,subprocess,sys

def verify(objects, project, run):
    for obj in objects:
        labels=obj.get('Labels') or obj.get('Config',{}).get('Labels') or {}
        if labels.get('com.docker.compose.project')!=project or labels.get('dev.mytko.acceptance')!=run:
            raise ValueError('Refusing cleanup: foreign or unlabeled resource')
if __name__=='__main__':
    project,run=sys.argv[1:]
    if not project.startswith('tasks-validation-') or not run.startswith('tasks-lite-'):raise SystemExit('Invalid ownership scope')
    for kind,args in [('container',['ps','-aq']),('volume',['volume','ls','-q']),('network',['network','ls','-q'])]:
        ids=subprocess.check_output(['docker',*args,'--filter',f'label=com.docker.compose.project={project}'],text=True).split()
        for ident in ids:
            data=json.loads(subprocess.check_output(['docker',kind,'inspect',ident],text=True))
            verify(data,project,run)
