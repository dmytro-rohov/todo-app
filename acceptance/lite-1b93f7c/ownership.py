#!/usr/bin/env python3
"""Verify and, only with --cleanup, remove this run's exact Docker resources."""
import json, subprocess, sys

def verify(objects, project, run):
    for obj in objects:
        labels = obj.get("Labels") or obj.get("Config", {}).get("Labels") or {}
        if labels.get("com.docker.compose.project") != project or labels.get("dev.mytko.acceptance") != run:
            raise ValueError("Refusing cleanup: foreign or unlabeled resource")

def inspect(kind, ident):
    return json.loads(subprocess.check_output(["docker", kind, "inspect", ident], text=True))[0]

def resources(project, run):
    found = []
    for kind, args in (("container", ["ps", "-aq"]), ("volume", ["volume", "ls", "-q"]), ("network", ["network", "ls", "-q"])):
        for ident in subprocess.check_output(["docker", *args], text=True).split():
            data = inspect(kind, ident)
            labels = data.get("Config", {}).get("Labels", {}) if kind == "container" else data.get("Labels", {})
            if labels.get("com.docker.compose.project") == project or labels.get("dev.mytko.acceptance") == run:
                if labels.get("com.docker.compose.project") != project or labels.get("dev.mytko.acceptance") != run:
                    raise ValueError("Refusing cleanup: foreign or unlabeled resource")
                found.append((kind, ident))
    return found

if __name__ == "__main__":
    if len(sys.argv) not in (3, 4): raise SystemExit("usage: ownership.py PROJECT RUN [--cleanup]")
    project, run = sys.argv[1:3]
    if not project.startswith("tasks-validation-") or not run.startswith("tasks-lite-"): raise SystemExit("Invalid ownership scope")
    found = resources(project, run)
    if len(sys.argv) == 4:
        if sys.argv[3] != "--cleanup": raise SystemExit("unknown mode")
        raise SystemExit("Automatic deletion refused: Docker has no atomic ownership-check-and-delete; operator must inspect retained IDs")
    else:
        print(json.dumps({"status":"PASS", "project":project, "run":run, "resources":[{"kind":k,"id":i} for k,i in found]}))
