# Docker

> [!NOTE]
> The Docker configuration for shelf.nu is an effort powered by people within the community, done by [@anatolinicolae](https://github.com/anatolinicolae). Shelf Asset Management Inc. does not yet provide official support for Docker, but we will accept fixes and documentation at this time. Use at your own risk.

## Prerequisites

> [!IMPORTANT]
> If you want to run shelf via docker, there are still some prerequisites you need to meet. Because our docker setup doesn't currently support self-hosting supabase, you need to complete the steps below. This means you have to take care of setting up your Supabase environment, running migrations against your database, and making sure Supabase is configured based on our requirements.

1. [Local Development Guide](./local-development.md) - Setup your development environment
2. [Supabase Setup Guide](./supabase-setup.md) - Configure your database and authentication

This will make sure you have a DATABASE that you are ready to connect to.

## Instructions

1. Make sure you have Docker installed on your machine
2. Use the `docker run` command and replace your environment variables:

```bash
docker run -d \
  --name "shelf" \
  -e "DATABASE_URL=postgres://USER:PASSWORD@HOST:6543/DB_NAME?pgbouncer=true" \
  -e "DIRECT_URL=postgres://USER:PASSWORD@HOST:5432/DB_NAME" \
  -e 'SUPABASE_ANON_PUBLIC=your-anon-public-key' \
  -e 'SUPABASE_SERVICE_ROLE=your-service-role-key' \
  -e 'SUPABASE_URL=https://your-instance-name.supabase.co' \
  -e 'SESSION_SECRET=super-duper-s3cret' \
  -e 'SERVER_URL=http://localhost:3000' \
  -e 'MAPTILER_TOKEN=your-maptiler-token' \
  -e 'SMTP_HOST=mail.example.com' \
  -e 'SMTP_PORT=465' \
  -e 'SMTP_USER=some-email@example.com' \
  -e 'SMTP_FROM="Your Name from shelf.nu" <your-email@shelf.nu>' \
  -e 'SMTP_PWD=super-safe-passw0rd' \
  -e 'INVITE_TOKEN_SECRET=another-super-duper-s3cret' \
  -p 3000:8080 \
  --restart unless-stopped \
  ghcr.io/shelf-nu/shelf.nu:latest
```

> [!NOTE]
> Replace the placeholder values with your actual configuration:
>
> - `USER`, `PASSWORD`, `HOST`, `DB_NAME` - Your Supabase database details
> - `your-anon-public-key`, `your-service-role-key` - From Supabase API settings
> - `your-instance-name` - Your Supabase project reference
> - Other tokens and secrets as needed

`DATABASE_URL` and `DIRECT_URL` are mandatory when using Supabase Cloud. Learn more in the [Supabase Setup Guide](./supabase-setup.md).

## Development

> [!CAUTION]
> During development involving Dockerfile changes, make sure to **address the correct Dockerfile** in your builds:
>
> - Fly.io will be built via `Dockerfile`
> - ghcr.io will be built via `Dockerfile.image`

By default both Fly.io and Docker will build via `Dockerfile` unless specifically instructed. Learn more [about Fly.io Config](https://fly.io/docs/reference/configuration/#specify-a-dockerfile) and [Docker image builds](https://docs.docker.com/reference/cli/docker/image/build/#file).

In order to build a local Docker image just as the one we provide for self-hosting, you'll have to build `Dockerfile.image` using buildx as follows:

```bash
docker buildx build \
   --platform linux/amd64,linux/arm64 \
   --tag shelf-local \
   --file Dockerfile.image .
```

Then running the locally-built image should be as simple as:

```bash
docker run -d \
   --name "shelf" \
   -e DATABASE_URL="your-database-url" \
   -e DIRECT_URL="your-direct-url" \
   -e SUPABASE_URL="your-supabase-url" \
   shelf-local
```

### ARM processors

You can also run shelf on ARM64 processors.

1. Linux / Pine A64

   ```bash
   docker run -it --rm --entrypoint /usr/bin/uname ghcr.io/shelf-nu/shelf.nu:latest -a
   # Expected output: Linux ... aarch64 GNU/Linux
   ```

2. MacOS / M1 Max

   ```bash
   docker run -it --rm --platform linux/arm64 --entrypoint /usr/bin/uname ghcr.io/shelf-nu/shelf.nu:latest -a
   # Expected output: Linux ... aarch64 GNU/Linux
   ```
