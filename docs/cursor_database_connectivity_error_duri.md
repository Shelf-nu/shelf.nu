# Database connectivity error during deployment
_Exported on 09/05/2026 at 14:42:19 CEST from Cursor (3.3.22)_

---

**User**

i managed to deploy the app
i should have added the right database address, but i get this error

🚀 Server started on port 8080
🌍 http://127.0.0.1:8080
🏎️ Server started in 3672ms
Scheduler and workers registration completed
{"level":50,"time":1778326641017,"pid":7,"hostname":"39c30ea630fb","err":{"cause":{"errno":-3008,"code":"ENOTFOUND","syscall":"getaddrinfo","hostname":"host.docker.internal","stack":"Error: getaddrinfo ENOTFOUND host.docker.internal\n    at /src/node_modules/.pnpm/pg-pool@3.11.0_pg@8.18.0/node_modules/pg-pool/index.js:45:11\n    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)\n    at async Db.executeSql (/src/node_modules/.pnpm/pg-boss@9.0.3/node_modules/pg-boss/src/db.js:28:14)\n    at async Contractor.isInstalled (/src/node_modules/.pnpm/pg-boss@9.0.3/node_modules/pg-boss/src/contractor.js:32:20)\n    at async Contractor.start (/src/node_modules/.pnpm/pg-boss@9.0.3/node_modules/pg-boss/src/contractor.js:37:23)\n    at async PgBoss.start (/src/node_modules/.pnpm/pg-boss@9.0.3/node_modules/pg-boss/src/index.js:101:5)\n    at async init (file:///src/apps/webapp/build/server/assets/server-build.js:183:5)"},"label":"Scheduler","shouldBeCaptured":true,"status":500,"traceId":"l394uatthvvvnkk7uw8iyhq2","name":"ShelfError","message":"Scheduler crash","stack":"ShelfError: Scheduler crash\n    at file:///src/apps/webapp/build/server/assets/server-build.js:27544:5\n    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)"},"msg":"Scheduler crash"}
<-- GET /
--> GET / 302 24ms
<-- GET /login
--> GET /login 200 42ms
<-- GET /login
--> GET /login 200 17ms
<-- GET /__manifest?paths=%2F%2C%2Fforgot-password%2C%2Fjoin%2C%2Flogin%2C%2Fsend-otp%2C%2Fsso-login&version=a58aa515
--> GET /__manifest?paths=%2F%2C%2Fforgot-password%2C%2Fjoin%2C%2Flogin%2C%2Fsend-otp%2C%2Fsso-login&version=a58aa515 200 16ms
<-- GET /login
--> GET /login 200 16ms
<-- GET /login
--> GET /login 200 14ms
<-- GET /__manifest?paths=%2F%2C%2Fforgot-password%2C%2Fjoin%2C%2Flogin%2C%2Fsend-otp%2C%2Fsso-login&version=a58aa515
--> GET /__manifest?paths=%2F%2C%2Fforgot-password%2C%2Fjoin%2C%2Flogin%2C%2Fsend-otp%2C%2Fsso-login&version=a58aa515 200 16ms
<-- POST /login.data
{"level":50,"time":1778326953352,"pid":7,"hostname":"39c30ea630fb","err":{"cause":{"__isAuthError":true,"name":"AuthApiError","status":400,"code":"invalid_credentials","stack":"AuthApiError: Invalid login credentials\n    at handleError (/src/node_modules/.pnpm/@supabase+auth-js@2.105.1/node_modules/@supabase/auth-js/dist/main/lib/fetch.js:69:11)\n    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)\n    at async _handleRequest (/src/node_modules/.pnpm/@supabase+auth-js@2.105.1/node_modules/@supabase/auth-js/dist/main/lib/fetch.js:112:9)\n    at async _request (/src/node_modules/.pnpm/@supabase+auth-js@2.105.1/node_modules/@supabase/auth-js/dist/main/lib/fetch.js:94:18)\n    at async SupabaseAuthClient.signInWithPassword (/src/node_modules/.pnpm/@supabase+auth-js@2.105.1/node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:815:23)\n    at async signInWithEmail (file:///src/apps/webapp/build/server/assets/index-Bajr6ERf.js:893:44)\n    at async action$2y (file:///src/apps/webapp/build/server/assets/server-build.js:31140:29)\n    at async callRouteHandler (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-2UH5WJXA.mjs:510:16)\n    at async file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4855:19\n    at async callLoaderOrAction (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4907:16)"},"label":"Auth","additionalData":{},"shouldBeCaptured":false,"status":500,"traceId":"s8x65th61ldevztkh5016lm8","name":"ShelfError","message":"Incorrect email or password","stack":"ShelfError: Incorrect email or password\n    at makeShelfError (file:///src/apps/webapp/build/server/assets/index-Bajr6ERf.js:162:12)\n    at action$2y (file:///src/apps/webapp/build/server/assets/server-build.js:31161:20)\n    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)\n    at async callRouteHandler (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-2UH5WJXA.mjs:510:16)\n    at async file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4855:19\n    at async callLoaderOrAction (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4907:16)\n    at async Promise.all (index 0)\n    at async defaultDataStrategy (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4532:17)\n    at async callDataStrategyImpl (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4799:17)\n    at async callDataStrategy (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:3825:19)"},"msg":"Incorrect email or password"}
--> POST /login.data 500 293ms
<-- GET /join.data?_routes=routes%2F_auth%2B%2F_auth%2Croutes%2F_auth%2B%2Fjoin
--> GET /join.data?_routes=routes%2F_auth%2B%2F_auth%2Croutes%2F_auth%2B%2Fjoin 200 9ms
<-- POST /join.data
{"level":50,"time":1778326963464,"pid":7,"hostname":"39c30ea630fb","err":{"cause":{"cause":{"clientVersion":"6.19.3","name":"PrismaClientInitializationError","stack":"PrismaClientInitializationError: \nInvalid `prisma.$queryRaw()` invocation:\n\n\nCan't reach database server at `host.docker.internal:6543`\n\nPlease make sure your database server is running at `host.docker.internal:6543`.\n    at ei.handleRequestError (/src/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_magicast@0.3.5_typescript@6.0.3__typescript@6.0.3/node_modules/@prisma/client/runtime/library.js:121:7568)\n    at ei.handleAndLogRequestError (/src/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_magicast@0.3.5_typescript@6.0.3__typescript@6.0.3/node_modules/@prisma/client/runtime/library.js:121:6593)\n    at ei.request (/src/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_magicast@0.3.5_typescript@6.0.3__typescript@6.0.3/node_modules/@prisma/client/runtime/library.js:121:6300)\n    at async a (/src/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_magicast@0.3.5_typescript@6.0.3__typescript@6.0.3/node_modules/@prisma/client/runtime/library.js:130:9551)\n    at async checkDomainSSOStatus (file:///src/apps/webapp/build/server/assets/server-build.js:29448:24)\n    at async validateNonSSOSignup (file:///src/apps/webapp/build/server/assets/server-build.js:29506:24)\n    at async action$2z (file:///src/apps/webapp/build/server/assets/server-build.js:30933:9)\n    at async callRouteHandler (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-2UH5WJXA.mjs:510:16)\n    at async file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4855:19\n    at async callLoaderOrAction (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4907:16)"},"label":"SSO","additionalData":{"email":"giovanniabb@gmail.com"},"shouldBeCaptured":true,"status":500,"traceId":"m17cvi6qqtjsziciuwcu6dqe","name":"ShelfError","message":"Failed to check domain SSO status","stack":"ShelfError: Failed to check domain SSO status\n    at checkDomainSSOStatus (file:///src/apps/webapp/build/server/assets/server-build.js:29480:11)\n    at async validateNonSSOSignup (file:///src/apps/webapp/build/server/assets/server-build.js:29506:24)\n    at async action$2z (file:///src/apps/webapp/build/server/assets/server-build.js:30933:9)\n    at async callRouteHandler (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-2UH5WJXA.mjs:510:16)\n    at async file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4855:19\n    at async callLoaderOrAction (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4907:16)\n    at async Promise.all (index 0)\n    at async defaultDataStrategy (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4532:17)\n    at async callDataStrategyImpl (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4799:17)\n    at async callDataStrategy (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:3825:19)"},"label":"DB","shouldBeCaptured":true,"status":503,"traceId":"k83whxtgqabeu3hhj4gr1ruu","name":"ShelfError","message":"We're experiencing temporary database connectivity issues. Please try again in a moment.","stack":"ShelfError: We're experiencing temporary database connectivity issues. Please try again in a moment.\n    at makeShelfError (file:///src/apps/webapp/build/server/assets/index-Bajr6ERf.js:138:12)\n    at action$2z (file:///src/apps/webapp/build/server/assets/server-build.js:30953:20)\n    at async callRouteHandler (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-2UH5WJXA.mjs:510:16)\n    at async file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4855:19\n    at async callLoaderOrAction (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4907:16)\n    at async Promise.all (index 0)\n    at async defaultDataStrategy (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4532:17)\n    at async callDataStrategyImpl (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:4799:17)\n    at async callDataStrategy (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:3825:19)\n    at async submit (file:///src/node_modules/.pnpm/react-router@7.14.0_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/react-router/dist/development/chunk-QFMPRPBF.mjs:3622:21)"},"msg":"We're experiencing temporary database connectivity issues. Please try again in a moment."}
--> POST /join.data 503 57ms
+ NODE_ENV=production node ./build/server/index.js

what can you tell me?

---

**Cursor**

Diagnosing: the app inside Docker still resolves the DB host as `host.docker.internal:6543`. That hostname usually works only on Docker Desktop (Mac/Windows); it doesn’t exist by default on Linux production hosts (Fly, VPS, GitHub Actions, etc.), which causes `ENOTFOUND` and Prisma “can’t reach database server”. Checking your `docker-compose.yml` for how env vars are wired.



Here’s what your logs are telling you.

## 1. Database: `host.docker.internal` (main issue)

Both failures come from the same place:

- **pg-boss / scheduler:** `getaddrinfo ENOTFOUND host.docker.internal`
- **Prisma:** `Can't reach database server at host.docker.internal:6543`

So **`DATABASE_URL` (and very likely `DIRECT_URL`) inside the running container still use the hostname `host.docker.internal`.**

That name is meant for **“Postgres on my laptop while the app runs in Docker Desktop.”** On **Linux** servers (Coolify, many VPS setups, Fly without extras, etc.) it **usually does not exist**, so DNS fails with `ENOTFOUND` and nothing can connect.

**What to do**

- In **Coolify** (or wherever you set env vars), set **`DATABASE_URL` and `DIRECT_URL` to hosts that are reachable from the container**, not `host.docker.internal`.

Typical **Supabase hosted** values (from the dashboard → Database → connection strings):

- **`DATABASE_URL`**: pooler host, often `*.pooler.supabase.com`, port **6543**, with `?pgbouncer=true` (matches your `.env.example`).
- **`DIRECT_URL`**: direct DB host, often `*.supabase.co`, port **5432** (used by Prisma migrations / direct operations).

If Postgres is **another service in the same Compose stack**, use that **service name** as the host (e.g. `postgres:5432`), not `host.docker.internal`.

If you truly must reach the **Docker host** from a container on **Linux**, you’d need something like `extra_hosts: host.docker.internal:host-gateway` in Compose—but for cloud DB / Supabase you should **not** use `host.docker.internal` at all.

---

## 2. Login: `invalid_credentials`

That line is **Supabase Auth** rejecting email/password (`AuthApiError ... invalid_credentials`). It’s **not** proof the DB URL is wrong for login—it usually means **wrong password**, **user doesn’t exist in this Supabase project**, or **sign-in disabled**. Fix DB connectivity first, then confirm the user exists in the Supabase Auth UI for the same `SUPABASE_URL` / keys you deployed.

---

## 3. Scheduler crash vs HTTP

The app still serves `/` and `/login` because the web server starts; **background jobs (pg-boss)** crash when they open Postgres with the bad URL. After you fix `DATABASE_URL`, redeploy and confirm that scheduler error disappears.

**Summary:** Replace every `host.docker.internal` in **`DATABASE_URL`** and **`DIRECT_URL`** with your real Postgres / Supabase hostnames in the deployment secrets, redeploy, and retest signup/login.

---

**User**

this is my current situation (about 1 and 3):

SUPABASE_URL=https://supabase.lascuolaopensource.org/
SESSION_SECRET=Set SESSION_SECRET
SERVER_URL=https://ourfab.lascuolaopensource.org/
DATABASE_URL=postgresql://postgres.dev_tenant:AXxH23D1kJuuKanrGeYeN3AChXqm4hCI@host.docker.internal:6543/postgres?pgbouncer=true

---

**Cursor**

Here’s how your snippet fits with points **1** and **3**.

## `DATABASE_URL` still uses `host.docker.internal`

From inside the **webapp** container, `host.docker.internal` is wrong on Linux unless you explicitly added a host mapping. So the pooler at `:6543` is never reached — same as before.

You need a hostname that **that container** can resolve and reach:

| Situation | Use as DB host |
|-----------|------------------|
| Supabase stack + webapp on **same Docker network** (typical Coolify) | **Service/container name** of the pooler (often something like `supabase-pooler`, `pooler`, `supavisor`, or whatever your compose names it), **not** `supabase.lascuolaopensource.org` unless you’ve exposed 6543 and routing works internally |
| Pooler only on host port-map | Either join webapp to Supabase’s network and use the **internal** pooler hostname, or use `extra_hosts: host.docker.internal:host-gateway` (Linux) — worse than fixing the real internal hostname |

So: open your **Supabase** compose / Coolify service list, find which service listens on **6543** (Supavisor/pooler), and put **that service name** (and internal port) in `DATABASE_URL`, e.g. conceptually:

`postgresql://...@<pooler-service-name>:6543/postgres?pgbouncer=true`

Use the exact user/password/db your self-hosted Supabase expects for the pooler (your `postgres.dev_tenant` style user may be correct for multi-tenant setups — keep whatever Supabase docs/dashboard say).

## Point 3 — scheduler / pg-boss

pg-boss uses **`DATABASE_URL`** (same as Prisma’s pooled URL in this app). Once `DATABASE_URL` points at a resolvable host, the **scheduler crash** should stop after redeploy.

You did **not** mention **`DIRECT_URL`**. Prisma still needs a **direct** Postgres URL (usually port **5432**, **not** through PgBouncer) for migrations and some operations. Set it to the **internal** Postgres service hostname from the same network, e.g.:

`postgresql://...@<db-service-name>:5432/postgres`

(Again: real service name from your Supabase stack.)

## Extra checks

1. **`SESSION_SECRET`** — If the value is literally the string `Set SESSION_SECRET`, replace it with a long random secret; that placeholder is not safe.

2. **`SUPABASE_URL`** — Must match how the **API** is reached by the server (scheme + host). Trailing slash is usually fine if the app normalizes it; if anything auth-related misbehaves, compare with what Supabase prints as “Project URL”.

**Bottom line:** Keep user/password/query params as needed; **only change the host** in `DATABASE_URL` (and set **`DIRECT_URL`**) from `host.docker.internal` to the **Docker-internal pooler and DB hostnames** for your self-hosted Supabase stack, then redeploy the webapp.

---

**User**

this is my DIRECT_URL=postgresql://postgres:AXxH23D1kJuuKanrGeYeN3AChXqm4hCI@host.docker.internal:5432/postgres

---

**Cursor**

`DIRECT_URL` has the **same issue** as `DATABASE_URL`: the host **`host.docker.internal`** will not resolve from your Linux deployment container, so Prisma’s direct connection will keep failing for anything that uses `DIRECT_URL`.

**Fix:** point **`DIRECT_URL`** at the **real Postgres service** on your Docker network — same idea as the pooler, but port **5432** and the **direct** Postgres hostname (often something like `db`, `postgres`, `supabase-db`, depending on your Supabase compose).

**Also check credentials:** your earlier `DATABASE_URL` used user **`postgres.dev_tenant`** and this `DIRECT_URL` uses **`postgres`**. For a single deploy they often need to match whatever your Supabase stack actually configures for:

- **pooled** access (6543 / pooler) → `DATABASE_URL`
- **direct** access (5432) → `DIRECT_URL`

If your setup uses one tenant user for both, use that user in **both** URLs (unless docs say otherwise).

**Summary:** replace `host.docker.internal` in **`DIRECT_URL`** with the internal hostname of the Postgres container on **5432**, align users/passwords with your Supabase config, redeploy.

---

**User**

the point is that shelf is outside the docker network, but:

---

# other apps connect:
https://github.com/bbtgnn/supabase-probe 
this app is deployed in the same coolify project and it reports good connection


---

# docker ps

docker ps
CONTAINER ID   IMAGE                                                                   COMMAND                  CREATED             STATUS                       PORTS                                                                                                                                                                NAMES
39c30ea630fb   shelf-webapp:latest                                                     "/src/apps/webapp/do…"   15 minutes ago      Up 15 minutes                0.0.0.0:8989->8080/tcp, [::]:8989->8080/tcp                                                                                                                          webapp-g82aq38mn7uuptbobv8pxe54-113414925432
8d39c1dc9983   tqq866obe5r755dskk0mle7s_app:d569a654b2006ad9011334b0718e10c54e669667   "docker-entrypoint.s…"   About an hour ago   Up About an hour             0.0.0.0:5555->3000/tcp, [::]:5555->3000/tcp                                                                                                                          app-tqq866obe5r755dskk0mle7s-104723478314
b72793fa3b9d   supabase/storage-api:v1.44.2                                            "docker-entrypoint.s…"   About an hour ago   Up About an hour (healthy)   5000/tcp                                                                                                                                                             supabase-storage-b12nuw5fs3l09ab67u9i7ste
f6002dfaebe7   supabase/studio:2026.03.16-sha-5528817                                  "docker-entrypoint.s…"   About an hour ago   Up About an hour (healthy)   3000/tcp                                                                                                                                                             supabase-studio-b12nuw5fs3l09ab67u9i7ste
ba0a657bea4c   supabase/postgres-meta:v0.95.2                                          "docker-entrypoint.s…"   About an hour ago   Up About an hour (healthy)   8080/tcp                                                                                                                                                             supabase-meta-b12nuw5fs3l09ab67u9i7ste
4ac71e8c558a   supabase/supavisor:2.7.4                                                "/usr/bin/tini -s -g…"   About an hour ago   Up About an hour (healthy)   0.0.0.0:6543->6543/tcp                                                                                                                                               supabase-supavisor-b12nuw5fs3l09ab67u9i7ste
72c0a4c8706c   supabase/gotrue:v2.186.0                                                "auth"                   About an hour ago   Up About an hour (healthy)                                                                                                                                                                        supabase-auth-b12nuw5fs3l09ab67u9i7ste
e7519c30ce07   supabase/realtime:v2.76.5                                               "/usr/bin/tini -s -g…"   About an hour ago   Up About an hour (healthy)                                                                                                                                                                        realtime-dev-b12nuw5fs3l09ab67u9i7ste
ec315df39dae   supabase/edge-runtime:v1.71.2                                           "edge-runtime start …"   About an hour ago   Up About an hour (healthy)                                                                                                                                                                        supabase-edge-functions-b12nuw5fs3l09ab67u9i7ste
ff47d1b5a9e2   kong/kong:3.9.1                                                         "/home/kong/kong-ent…"   About an hour ago   Up About an hour (healthy)   8000-8004/tcp, 8443-8447/tcp                                                                                                                                         supabase-kong-b12nuw5fs3l09ab67u9i7ste
b85f50e22c2e   postgrest/postgrest:v14.6                                               "postgrest"              About an hour ago   Up About an hour             3000/tcp                                                                                                                                                             supabase-rest-b12nuw5fs3l09ab67u9i7ste
9f86bbb41ea7   supabase/logflare:1.31.2                                                "sh run.sh"              About an hour ago   Up About an hour (healthy)                                                                                                                                                                        supabase-analytics-b12nuw5fs3l09ab67u9i7ste
73e5e6cc29ac   supabase/postgres:15.8.1.085                                            "docker-entrypoint.s…"   About an hour ago   Up About an hour (healthy)   0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp                                                                                                                          supabase-db-b12nuw5fs3l09ab67u9i7ste
3eeb1ba25004   timberio/vector:0.53.0-alpine                                           "/usr/local/bin/vect…"   About an hour ago   Up About an hour (healthy)                                                                                                                                                                        supabase-vector-b12nuw5fs3l09ab67u9i7ste
de13059c7a98   ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z                   "/usr/bin/docker-ent…"   About an hour ago   Up About an hour (healthy)   9000-9001/tcp                                                                                                                                                        supabase-minio-b12nuw5fs3l09ab67u9i7ste
e666004ce382   darthsim/imgproxy:v3.30.1                                               "entrypoint.sh imgpr…"   About an hour ago   Up About an hour (healthy)   8080/tcp                                                                                                                                                             imgproxy-b12nuw5fs3l09ab67u9i7ste
93b27848afbe   ghcr.io/coollabsio/sentinel:0.0.21                                      "/app/sentinel"          15 hours ago        Up 15 hours (healthy)                                                                                                                                                                             coolify-sentinel
13c38556cb85   traefik:v3.6                                                            "/entrypoint.sh --pi…"   15 hours ago        Up 15 hours (healthy)        0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp, 0.0.0.0:443->443/udp, [::]:443->443/udp   coolify-proxy
d250612e2542   ghcr.io/coollabsio/coolify:4.0.0                                        "docker-php-serversi…"   15 hours ago        Up 15 hours (healthy)        8000/tcp, 8443/tcp, 9000/tcp, 0.0.0.0:8000->8080/tcp, [::]:8000->8080/tcp                                                                                            coolify
264415d5e8ee   postgres:15-alpine                                                      "docker-entrypoint.s…"   15 hours ago        Up 15 hours (healthy)        5432/tcp                                                                                                                                                             coolify-db
bf3fbefdc4e5   redis:7-alpine                                                          "docker-entrypoint.s…"   15 hours ago        Up 15 hours (healthy)        6379/tcp                                                                                                                                                             coolify-redis
7fb3b17ae1fc   ghcr.io/coollabsio/coolify-realtime:1.0.13                              "/bin/sh /soketi-ent…"   15 hours ago        Up 15 hours (healthy)        0.0.0.0:6001-6002->6001-6002/tcp, [::]:6001-6002->6001-6002/tcp                                                                                                      coolify-realtime
root@cool-vdf:/# 

---

**Cursor**

Here’s the distilled picture.

## Why probe can work and Shelf didn’t

[Shelf was still configured with `host.docker.internal`](https://github.com/bbtgnn/supabase-probe) in `DATABASE_URL` / `DIRECT_URL`. On **Linux**, that name is **not** defined unless something (Compose `extra_hosts`, Coolify, etc.) adds it **for that specific service**.

So it’s entirely plausible that **[supabase-probe](https://github.com/bbtgnn/supabase-probe)** has env vars that use a **resolvable** host (or gets `host.docker.internal` injected for **that** app only), while **Shelf does not** — same Coolify project doesn’t guarantee identical Docker/network/env behavior per app.

Your `docker ps` output also matches the failure mode: Supavisor and Postgres are published on the **host** (`0.0.0.0:6543`, `0.0.0.0:5432`). From **another** container, the reliable path is usually **host IP / Docker bridge gateway**, not a magic hostname.

## What to do (practical)

1. **Align Shelf with probe**  
   In Coolify, open the **working** supabase-probe service and copy whatever it uses for `DATABASE_URL` and `DIRECT_URL` (host + ports only need to match how probe reaches DB).  
   Set **the same host part** (and same SSL/query params if probe uses them) on Shelf.  
   If probe documents optional `DB_SSL` etc., mirror that on Shelf if your Postgres requires TLS.

2. **If probe uses `host.docker.internal`**  
   Then Coolify may be adding it only for some stacks. Either:
   - add the same network/host alias for Shelf (Coolify “extra hosts” / custom compose), **or**
   - stop using `host.docker.internal` and use the **Docker host gateway IP** or **server LAN IP** that probe effectively uses.

3. **Quick verification** (on the server):

   ```bash
   docker exec -it webapp-g82aq38mn7uuptbobv8pxe54-113414925432 getent hosts host.docker.internal
   docker exec -it app-tqq866obe5r755dskk0mle7s-104723478314 getent hosts host.docker.internal
   ```

   If the first fails and the second works, that explains the difference.

4. **Connecting from “outside” Supabase’s compose network**  
   Because ports are published on the host, from Shelf’s container you typically want:

   - **Pooled:** `…@<host-reachable-from-shelf>:6543/…?pgbouncer=true`  
   - **Direct:** `…@<host-reachable-from-shelf>:5432/…`  

   where `<host-reachable-from-shelf>` is whatever works from **inside the Shelf container** (often the bridge gateway, e.g. `172.17.0.1` on simple setups — **Coolify’s bridge can differ**, so copying probe’s working host is safer than guessing).

## Credentials reminder

You previously had **`postgres.dev_tenant`** in `DATABASE_URL` and **`postgres`** in `DIRECT_URL`. Probe might use one consistent pair. Use the **same** user/password strategy that probe uses for pooled vs direct, or you’ll get confusing auth errors even when the host is right.

**Summary:** Shelf isn’t “blocked because it’s outside the network” — it’s blocked because **`host.docker.internal` isn’t resolving from that container**. Make Shelf’s DB URLs use **exactly the same reachable host(s)** as the green [supabase-probe](https://github.com/bbtgnn/supabase-probe) deployment (or add an explicit host mapping for Shelf).

---

**User**

root@cool-vdf:/# docker exec -it app-tqq866obe5r755dskk0mle7s-104723478314 getent hosts host.docker.internal
10.0.0.1          host.docker.internal  host.docker.internal
root@cool-vdf:/# docker exec -it webapp-g82aq38mn7uuptbobv8pxe54-113414925432 getent hosts host.docker.internal
root@cool-vdf:/# 
































---

**Cursor**

That output is the full explanation.

**Probe container:** `host.docker.internal` → `10.0.0.1`  
**Shelf container:** no entry → DNS fails → `ENOTFOUND` and Prisma/pg-boss errors.

Coolify (or the probe stack) is **injecting that hostname only for some apps**, not for Shelf.

### Fastest fix

In Shelf’s Coolify env, change both URLs from:

`...@host.docker.internal:6543/...` and `...@host.docker.internal:5432/...`

to:

`...@10.0.0.1:6543/...` and `...@10.0.0.1:5432/...`

(Keep user, password, db name, and `?pgbouncer=true` on the pool URL unchanged.)

That matches what probe actually resolves `host.docker.internal` to, so connectivity behavior should match probe.

### More portable / explicit

If Coolify lets you set **extra hosts** for Shelf, add:

`host.docker.internal=10.0.0.1`

(or the equivalent “Extra hosts” / Compose `extra_hosts` for that service)

Then you can keep `host.docker.internal` in the strings.

### Caveat

`10.0.0.1` is whatever gateway Coolify wired for **that** host; if you ever move servers or networks, re-check with `getent hosts host.docker.internal` from a container that **does** have the alias, or from Shelf after adding `extra_hosts`.

**Summary:** Shelf fails only because it never gets the `host.docker.internal` mapping. Point DB URLs at **`10.0.0.1`** or give Shelf the same **`extra_hosts`** as probe.

