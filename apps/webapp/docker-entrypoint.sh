#!/bin/sh -ex

# GHCR Docker image entrypoint (Dockerfile.image).
#
# NOTE: We call `node` directly instead of `pnpm run start` because the
# production Docker image does not include pnpm-workspace.yaml. Without it,
# pnpm cannot resolve the workspace and the server fails to start.

# Apply pending database migrations before starting the server.
# Set SKIP_MIGRATIONS=true to opt out (e.g. when migrations are run separately).
#
# The standalone Prisma CLI is run from its own directory so it doesn't pick up
# apps/webapp/prisma.config.ts, whose imports (dotenv, prisma/config) are pruned
# from the production image.
if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "Applying database migrations..."
  (
    cd /opt/prisma-cli &&
      PRISMA_HIDE_UPDATE_MESSAGE=1 ./node_modules/.bin/prisma migrate deploy \
        --schema /src/packages/database/prisma/schema.prisma
  )
fi

NODE_ENV=production node ./build/server/index.js
