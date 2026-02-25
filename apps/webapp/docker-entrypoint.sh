#!/bin/sh -ex

# GHCR Docker image entrypoint (Dockerfile.image).
#
# NOTE: We call `node` directly instead of `pnpm run start` because the
# production Docker image does not include pnpm-workspace.yaml. Without it,
# pnpm cannot resolve the workspace and the server fails to start.

NODE_ENV=production node ./build/server/index.js
