# Upgrade to Supabase's new API keys

Supabase is retiring its legacy API keys, the `anon` key and the `service_role` key. Its [migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys) and your project's **API Keys** page give Supabase's current schedule, so migrate by whichever date comes first: Supabase's, or Shelf's **2027-02-18** below. Shelf now supports the keys that replace them: a **publishable key** (`sb_publishable_...`) and a **secret key** (`sb_secret_...`).

This guide is for anyone running their own Shelf instance. If you use Shelf at [shelf.nu](https://www.shelf.nu), there is nothing to do.

## What changes and when

| Setting                 | Before                    | After                                  |
| ----------------------- | ------------------------- | -------------------------------------- |
| `SUPABASE_ANON_PUBLIC`  | legacy `anon` key         | publishable key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY`   | (did not exist)           | secret key (`sb_secret_...`)           |
| `SUPABASE_SERVICE_ROLE` | legacy `service_role` key | remove it                              |

- **Until 2027-02-18**, Shelf still accepts `SUPABASE_SERVICE_ROLE` when `SUPABASE_SECRET_KEY` is not set. It logs this warning at startup:

  ```
  DEPRECATED CONFIGURATION: SUPABASE_SERVICE_ROLE is set without SUPABASE_SECRET_KEY.
  ```

- **Releases after 2027-02-18** require `SUPABASE_SECRET_KEY`. An instance still on `SUPABASE_SERVICE_ROLE` will not start.
- No database migration is involved, and no Shelf data changes.

The secret key does one more thing: it lets Shelf tell Supabase who is signing in. Supabase limits sign-in attempts per IP address. Shelf signs people in from its server, so without the secret key Supabase counts every visitor against your server's address. See [Per-visitor sign-in limits](#per-visitor-sign-in-limits-optional).

## Upgrade steps

1. **Get the keys.** In your Supabase project, open **Project Settings** → **API Keys**.

   - Copy the **publishable key** (`sb_publishable_...`).
   - Under **Secret keys**, create a key if there is none, then copy it (`sb_secret_...`). Treat it like a password: it has full access to your project.

   On a local Supabase started with the CLI, run `supabase status` instead. It prints both keys. If it shows no `sb_secret_...` key, update the Supabase CLI.

2. **Update your environment.** Use the keys from the **same** Supabase project that `SUPABASE_URL` points at:

   ```bash
   SUPABASE_URL="https://your-project-ref.supabase.co"
   SUPABASE_ANON_PUBLIC="sb_publishable_..."
   SUPABASE_SECRET_KEY="sb_secret_..."
   # SUPABASE_SERVICE_ROLE="..."   # remove or comment out
   ```

   On Docker, pass `-e 'SUPABASE_SECRET_KEY=...'` (see [Docker Setup](../docker.md)). On Fly.io, run `fly secrets set SUPABASE_SECRET_KEY=... SUPABASE_ANON_PUBLIC=...` (see [Deployment](../deployment.md)).

3. **Restart Shelf** and check that the `DEPRECATED CONFIGURATION` warning no longer appears in the startup log.

4. **Check that it works:**
   - sign in with a password
   - sign in with a one-time email code
   - reset a password
   - upload an image (a profile picture or an asset image)
   - if you use SSO, sign in through `/sso-login`, from your identity provider's dashboard, and in the companion app

## Per-visitor sign-in limits (optional)

With `SUPABASE_SECRET_KEY` set, Shelf can send each visitor's IP address to Supabase, so its sign-in limits count each visitor instead of your server. This covers password sign-in, sign-up, one-time codes, password reset, email change, session refresh and SSO.

1. In Supabase, open **Authentication** → **Rate Limits** and turn on **IP Address Forwarding**.
2. Tell Shelf where the visitor's IP comes from:

   - **Behind your own reverse proxy** (nginx, Caddy, Traefik, and so on): set `TRUSTED_PROXY_HOPS` to the number of proxies in front of Shelf that append to `X-Forwarded-For`, usually `1`. Shelf reads the entry your outermost proxy added.

     > [!WARNING]
     > This is only safe when every request reaches Shelf through those proxies. Do not expose the app port (3000 by default) directly: bind it to localhost or a private network, or firewall it. Otherwise a visitor can connect around the proxies and choose the address Shelf reads.

   - **On Fly.io:** nothing to set. Shelf reads `Fly-Client-IP`.
   - **On Fly.io behind Cloudflare:** `Fly-Client-IP` is then Cloudflare's address. Add a Cloudflare Transform Rule (**Rules** → **Transform Rules** → **Modify Request Header**) that sets `X-Shelf-Proxy-Secret` to a random value (`openssl rand -hex 32`) on all incoming requests, and set the same value as `CLOUDFLARE_PROXY_SECRET`. Shelf then reads `CF-Connecting-IP`, but only from requests that carry that secret.

3. Review the limits on the same **Rate Limits** page. People signing in from one office often share one IP address.

Without IP forwarding, nothing breaks: Supabase keeps counting sign-ins against your server's address, as before.

## Troubleshooting

**Sign-in fails with "Invalid API key".** The key and `SUPABASE_URL` belong to different Supabase projects. Check the key against the URL directly; `200` means it is valid for that project:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$SUPABASE_URL/auth/v1/settings" -H "apikey: sb_secret_..."
```

Also check that your `.env` does not define the same variable twice, for example an old commented-in value further down.

**The deprecation warning still appears.** `SUPABASE_SECRET_KEY` is not reaching the server. Check the spelling, and restart the server after changing the environment.

**Supabase's logs show your server's IP, not the visitor's.** Check that IP Address Forwarding is on in Supabase, that `SUPABASE_SECRET_KEY` is set, and, off Fly.io, that `TRUSTED_PROXY_HOPS` matches your proxies.

## See also

- [Supabase Setup](../supabase-setup.md)
- [Supabase: migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Supabase: Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
