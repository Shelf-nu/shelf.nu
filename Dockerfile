# Base Node image
FROM node:22.20.0-bookworm-slim AS base

# Set for base and all layer that inherit from it
ENV PORT="8080"
ENV NODE_ENV="production"
ARG DEBIAN_FRONTEND="noninteractive"
WORKDIR /src

# Install openssl for Prisma
RUN apt-get update && \
    apt-get install -y openssl && \
    rm -rf /var/lib/apt/lists/*


# Install all node_modules, including dev dependencies
FROM base AS deps

ADD package.json .
RUN npm install --include=dev

# Build the app and setup production node_modules
FROM base AS build

COPY --from=deps /src/node_modules /src/node_modules

ADD . .

RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# Finally, build the production image with minimal footprint
FROM base AS release

COPY --from=build /src/node_modules /src/node_modules
COPY --from=build /src/app/database /src/app/database
COPY --from=build /src/build /src/build
COPY --from=build /src/package.json /src/package.json
COPY --from=build /src/start.sh /src/start.sh

RUN chmod +x /src/start.sh

ENTRYPOINT [ "/src/start.sh" ]
