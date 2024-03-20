# Docker
> [!NOTE]
> The Docker configuration for shelf.nu is an effort powered by people within the community, done by [@anatolinicolae](https://github.com/anatolinicolae). Shelf Asset Management Inc. does not yet provide official support for Docker, but we will accept fixes and documentation at this time. Use at your own risk.

## Prerequisites

> [!IMPORTANT]
> If you want to run shelf via docker, there are still some prerequisites you need to meet. Because our docker setup doesn't currently support self-hosting supabase, you need to complete the steps below. This means you have to take care of setting up your supabase environment, running migrations against your database, and making sure Supabase is configured based on our requirements.

1. https://github.com/Shelf-nu/shelf.nu/blob/main/docs/get-started.md#development
2. https://github.com/Shelf-nu/shelf.nu/blob/main/docs/get-started.md#authentication

This will make sure you have a DATABASE that you are ready to connect to.

## Instructions

1. Make sure you have docker installed on your machine
2. Use the docker run command and replace your env varibales:

```sh
docker run -d \
  --name "shelf" \
  -e "DATABASE_URL=postgres://{USER}:{PASSWORD}@{HOST}:6543/{DB_NAME}?pgbouncer=true" \
  -e "DIRECT_URL=postgres://{USER}:{PASSWORD}@{HOST}:5432/{DB_NAME}" \
  -e 'SUPABASE_ANON_PUBLIC=ANON_PUBLIC' \
  -e 'SUPABASE_SERVICE_ROLE=SERVICE_ROLE' \
  -e 'SUPABASE_URL=https://{YOUR_INSTANCE_NAME}.supabase.co' \
  -e 'SESSION_SECRET=super-duper-s3cret' \
  -e 'SERVER_URL=http://localhost:3000' \
  -e 'MAPTILER_TOKEN=maptiler-token' \
  -e 'SMTP_HOST=mail.example.com' \
  -e 'SMTP_USER=some-email@example.com' \
  -e 'SMTP_PWD=super-safe-passw0rd' \
  -p 3000:8080 \
  --restart unless-stopped \
  ghcr.io/shelf-nu/shelf.nu:latest
```

### ARM processors

You can also run shelf on ARM64 processors.

1. Linux / Pine A64

```shell
root@DietPi:~#
docker run -it --rm --entrypoint /usr/bin/uname ghcr.io/thundersquared/shelf:latest -a
Linux 77ae434f8fe9 6.1.63-current-sunxi64 #1 SMP Mon Nov 20 10:52:19 UTC 2023 aarch64 GNU/Linux
```

2. MacOS / M1 Max

```shell
❯ ~
docker run -it --rm --platform linux/arm64 --entrypoint /usr/bin/uname ghcr.io/thundersquared/shelf:latest -a
Linux 7a9dff819847 6.5.13-orbstack-00122-g57b8027e2387 #1 SMP Tue Feb  6 07:48:26 UTC 2024 aarch64 GNU/Linux
```
