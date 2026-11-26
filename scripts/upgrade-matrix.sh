#!/usr/bin/env bash
# Host entry for the upgrade fixture matrix (issue #143).
# Requires: docker. Needs network for the npm registry inside the container.
# Does not bind-mount host node_modules (COPY / staged context only).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="stagepass-upgrade-matrix:$$"
CTX=""
KEEP_IMAGE=0
TARGET="local"
ONLY=""
HELP=0

usage() {
  cat <<'EOF'
Usage: scripts/upgrade-matrix.sh [options]

Docker-based upgrade regression matrix for CLI fixtures 2.2.7, 2.3.0, 2.4.0.
Builds a clean node:22 image from a staged copy of this checkout (no host
node_modules bind mounts), runs the in-container assertions, then removes the
temporary image and containers it created.

Options:
  --target local|latest   CLI under test (default: local = npm pack of this checkout).
                          Use --target latest after publishing to re-check against
                          @stagepass/cli@latest on the npm registry.
  --only <version>        Run a single fixture (2.2.7, 2.3.0, or 2.4.0).
  --keep-image            Do not docker rmi the temporary image after the run.
  -h, --help              Show this help.

Requirements:
  - docker on PATH, with a working daemon (`docker info`)
  - network access to the npm registry (inside the container)
  - self-hosted runner label [self-hosted, cerebro] for CI; not GitHub-hosted

Examples:
  scripts/upgrade-matrix.sh
  scripts/upgrade-matrix.sh --only 2.3.0
  scripts/upgrade-matrix.sh --target latest
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --only)
      ONLY="${2:-}"
      shift 2
      ;;
    --keep-image)
      KEEP_IMAGE=1
      shift
      ;;
    -h|--help)
      HELP=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$HELP" -eq 1 ]]; then
  usage
  exit 0
fi

if [[ "$TARGET" != "local" && "$TARGET" != "latest" ]]; then
  echo "--target must be local or latest (got: $TARGET)" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required on PATH" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker info failed: the Docker daemon is unreachable." >&2
  echo "On the os self-hosted runner container, the Docker socket may not be mounted." >&2
  echo "Mount the host Docker socket (or run where Docker is available) and retry." >&2
  exit 1
fi

cleanup() {
  local code=$?
  if [[ -n "$CTX" && -d "$CTX" ]]; then
    rm -rf "$CTX"
  fi
  if [[ "$KEEP_IMAGE" -eq 0 ]]; then
    docker rmi -f "$IMAGE_TAG" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap cleanup EXIT

echo "==> Staging build context (no node_modules)..."
CTX="$(mktemp -d "${TMPDIR:-/tmp}/stagepass-upgrade-matrix-ctx.XXXXXX")"

# Minimal monorepo slice for pack + matrix runner.
mkdir -p "$CTX/packages" "$CTX/scripts"
cp -a "$ROOT/package.json" "$ROOT/package-lock.json" "$CTX/"
cp -a "$ROOT/packages/cli" "$CTX/packages/cli"
cp -a "$ROOT/packages/loader" "$CTX/packages/loader"
cp -a "$ROOT/packages/modules" "$CTX/packages/modules"
cp -a "$ROOT/scripts/upgrade-matrix" "$CTX/scripts/upgrade-matrix"
cp -a "$ROOT/scripts/sync-cli-versions.mjs" "$CTX/scripts/sync-cli-versions.mjs"
# Drop any accidental host node_modules from the copy.
rm -rf \
  "$CTX/node_modules" \
  "$CTX/packages/cli/node_modules" \
  "$CTX/packages/loader/node_modules" \
  "$CTX/packages/modules/node_modules" \
  "$CTX/packages/cli/coverage" \
  "$CTX/packages/loader/coverage" \
  "$CTX/packages/modules/coverage"

cp "$ROOT/scripts/upgrade-matrix/Dockerfile" "$CTX/Dockerfile"

echo "==> Building image ${IMAGE_TAG}..."
docker build -t "${IMAGE_TAG}" "$CTX"

ARGS=(--target "$TARGET")
if [[ -n "$ONLY" ]]; then
  ARGS+=(--only "$ONLY")
fi

echo "==> Running matrix (target=${TARGET}${ONLY:+ only=${ONLY}})..."
set +e
# Default bridge networking (works on Docker Desktop and typical Linux runners).
# The container needs outbound access to the npm registry.
docker run --rm "${IMAGE_TAG}" "${ARGS[@]}"
status=$?
set -e

if [[ "$status" -ne 0 ]]; then
  echo "upgrade-matrix failed (exit $status)" >&2
  exit "$status"
fi

echo "upgrade-matrix passed."
