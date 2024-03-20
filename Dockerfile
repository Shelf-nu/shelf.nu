# base node image
FROM node:20-bookworm-slim as base

# set for base and all layer that inherit from it
ENV NODE_ENV="production"

WORKDIR /myapp

# Install openssl for Prisma
RUN apt-get update && apt-get install -y openssl

# Install all node_modules, including dev dependencies
FROM base as deps

ADD package.json ./
RUN npm install --production=false

# Setup production node_modules
FROM base as production-deps

COPY --from=deps /myapp/node_modules /myapp/node_modules
ADD package.json ./
RUN npm prune --production

# Build the app
FROM base as build

COPY --from=deps /myapp/node_modules /myapp/node_modules

ADD /app/database ./app/database
RUN npx prisma generate

ADD . .
RUN npm run build

# Finally, build the production image with minimal footprint
FROM base

ENV PORT="8080"
ENV NODE_ENV="production"

COPY --from=production-deps /myapp/node_modules /myapp/node_modules
COPY --from=build /myapp/node_modules/.prisma /myapp/node_modules/.prisma
COPY --from=build /myapp/app/database /myapp/app/database

COPY --from=build /myapp/build /myapp/build
COPY --from=build /myapp/public /myapp/public
COPY --from=build /myapp/package.json /myapp/package.json
COPY --from=build /myapp/docker-entrypoint.sh /myapp/docker-entrypoint.sh
RUN chmod +x /myapp/docker-entrypoint.sh

ENTRYPOINT [ "/myapp/docker-entrypoint.sh" ]
