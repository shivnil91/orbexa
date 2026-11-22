#!/usr/bin/env bash
# Build and push the dev ECS images with docker buildx.
#
# PLATFORM defaults to linux/arm64. That matches the dev stack variable
# task_cpu_architecture, whose default is ARM64.
#
# The machine that runs this script is often x86_64 and cannot emulate arm64.
# Build natively instead:
#   PLATFORM=linux/amd64 ./scripts/build-and-push-dev.sh
# Then set task_cpu_architecture to X86_64 before the ECS task runs these
# images. An ARM64 task cannot start a linux/amd64 image.
#
# infra/modules/dev-stack defines one repository, aws_ecr_repository.app.
# Both images are pushed to the URL from
#   terraform -chdir=infra/envs/dev output -raw ecr_repository_url
# with tags api-<git short sha> and worker-<git short sha>.
# Login uses the AWS CLI's current profile and environment.
# API keys are not build arguments.
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi
if [[ "$#" -ne 0 ]]; then
  echo "usage: PLATFORM=linux/arm64|linux/amd64 $0" >&2
  exit 1
fi

PLATFORM="${PLATFORM:-linux/arm64}"
case "$PLATFORM" in
  linux/arm64|linux/amd64) ;;
  *)
    echo "PLATFORM must be linux/arm64 or linux/amd64 (got ${PLATFORM})" >&2
    exit 1
    ;;
esac

if [[ "$PLATFORM" == "linux/amd64" ]]; then
  echo "PLATFORM=linux/amd64. Set the dev stack variable task_cpu_architecture to X86_64 before the ECS task runs these images. The default is ARM64, which only starts linux/arm64 images." >&2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

sha="$(git rev-parse --short HEAD)"
ecr_url="$(terraform -chdir=infra/envs/dev output -raw ecr_repository_url)"
ecr_url="${ecr_url%/}"

module="infra/modules/dev-stack/main.tf"
if [[ -f "$module" ]]; then
  repo_count="$(grep -cE '^resource "aws_ecr_repository"' "$module" || true)"
  if [[ "$repo_count" != "1" ]]; then
    echo "infra/modules/dev-stack has ${repo_count} aws_ecr_repository resources. This script pushes api-<sha> and worker-<sha> only when there is one repository." >&2
    exit 1
  fi
fi

api_uri="${ecr_url}:api-${sha}"
worker_uri="${ecr_url}:worker-${sha}"
registry="${ecr_url%%/*}"
region="$(printf '%s\n' "$registry" | cut -d. -f4)"
if [[ -z "$region" || "$region" == "$registry" ]]; then
  echo "Could not read an ECR region from ${ecr_url}" >&2
  exit 1
fi

aws ecr get-login-password --region "$region" \
  | docker login --username AWS --password-stdin "$registry"

docker buildx build \
  --platform "$PLATFORM" \
  --file apps/web/Dockerfile \
  --tag "$api_uri" \
  --push \
  "$root"

docker buildx build \
  --platform "$PLATFORM" \
  --file workers/ai/Dockerfile \
  --tag "$worker_uri" \
  --push \
  "$root/workers/ai"

printf '%s\n' "$api_uri" "$worker_uri"
