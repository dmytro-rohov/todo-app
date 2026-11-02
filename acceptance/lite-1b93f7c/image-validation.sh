# Shared read-only Docker image validation. Callers provide PACKAGE_DIR.
repo_digest_matches() {
  python3 "$PACKAGE_DIR/image-validation.py" --match "$1" "$2"
}
check_image() (
  set -o pipefail
  docker image inspect "$1" | python3 "$PACKAGE_DIR/image-validation.py" "$1"
)
