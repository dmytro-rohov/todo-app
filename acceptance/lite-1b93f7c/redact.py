import json,sys
# Deliberate allowlist: never persist arbitrary inspect environment/command fields.
data=json.load(sys.stdin)
print(json.dumps([{'Id':x.get('Id'),'Image':x.get('Image'),'Architecture':x.get('Architecture'),'Os':x.get('Os'),'State':{'Status':x.get('State',{}).get('Status')},'Config':{'Labels':x.get('Config',{}).get('Labels')}} for x in data],indent=2))
