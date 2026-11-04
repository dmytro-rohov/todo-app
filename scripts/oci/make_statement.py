#!/usr/bin/env python3
"""Emit the Mytko RuntimeStatement (canonical JSON) for one built image. Stdlib only, so a project repo can copy it.

The output must equal ``mytko.domain.runtime_artifact.RuntimeStatement.canonical()`` byte for byte
(tests/test_oci_attestation_statement.py enforces it). Identities issued by Mytko's release ledger are inputs and
are never invented here; the CI workflow checks the ones it can recompute (SHA, source archive digest).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone

DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
SHA = re.compile(r"[0-9a-f]{40}")
REQUIRED_INPUTS = ("base_images", "dependencies", "parameters", "recipe", "toolchain")


def build_statement(*, project_id: str, release_id: str, merged_sha: str, source_archive_digest: str,
                    profile_digest: str, image: str, builder: str, platform: str, built_at: str,
                    build_inputs: dict[str, str]) -> bytes:
    if not SHA.fullmatch(merged_sha):
        raise SystemExit("merged_sha must be a full 40-hex SHA")
    for name, value in (("source_archive_digest", source_archive_digest), ("profile_digest", profile_digest),
                        *build_inputs.items()):
        if not DIGEST.fullmatch(value):
            raise SystemExit(f"{name} must be sha256:<64 hex>")
    if not set(REQUIRED_INPUTS) <= build_inputs.keys():
        raise SystemExit(f"build inputs must include {', '.join(REQUIRED_INPUTS)}")
    if not re.fullmatch(r"[^@\s]+@sha256:[0-9a-f]{64}", image):
        raise SystemExit("image must be <registry/repository>@sha256:<digest>")
    moment = datetime.fromisoformat(built_at)
    if moment.tzinfo is None:
        raise SystemExit("built_at must be timezone-aware")
    body = {
        "project_id": project_id, "release_id": release_id, "merged_sha": merged_sha,
        "source_archive_digest": source_archive_digest, "profile_digest": profile_digest,
        "image": image, "builder": builder, "platform": platform,
        "build_inputs": [list(item) for item in sorted(build_inputs.items())],
        "built_at": moment.isoformat(), "version": 1,
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("project-id", "release-id", "merged-sha", "source-archive-digest", "profile-digest",
                 "image", "builder", "platform"):
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--built-at", default=datetime.now(timezone.utc).isoformat())
    parser.add_argument("--input", action="append", default=[], metavar="NAME=sha256:DIGEST")
    args = parser.parse_args(argv)
    inputs = dict(item.split("=", 1) for item in args.input)
    sys.stdout.buffer.write(build_statement(
        project_id=args.project_id, release_id=args.release_id, merged_sha=args.merged_sha,
        source_archive_digest=args.source_archive_digest, profile_digest=args.profile_digest, image=args.image,
        builder=args.builder, platform=args.platform, built_at=args.built_at, build_inputs=inputs))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
