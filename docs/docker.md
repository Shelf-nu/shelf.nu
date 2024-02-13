# Docker

If you prefer using docker for running shelf locally or self hosting your live app, we have a Docker image ready for you thanks to [@anatolinicolae](https://github.com/anatolinicolae)

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
  ghcr.io/thundersquared/shelf:latest
```

### ARM processors

You can also run shelf on ARM processors.

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
