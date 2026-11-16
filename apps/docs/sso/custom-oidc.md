# Custom OIDC Login (self-hosted)

Shelf can sign users in through one OpenID Connect (or plain OAuth2) identity
provider of your choice, for example Keycloak, Authentik, Ory Hydra or
Authelia. The login page shows a single "Log in with ..." button and nobody is
asked for a company domain.

This is separate from the domain-based [SAML SSO](./index.md). Use it when you
self-host Shelf and everyone signs in through the same identity provider.

It builds on Supabase Auth's
[custom OAuth and OIDC providers](https://supabase.com/docs/guides/auth/custom-oauth-providers):
the provider's client id, client secret and issuer are stored in Supabase,
Shelf only knows the provider's identifier.

## Requirements

- Supabase Auth (GoTrue) **2.192.0 or newer**. Older versions cannot pass a
  groups claim on (`custom_claims_allowlist`). Logging in works from the
  version that introduced custom providers, the group mapping does not.
- An OAuth client at your identity provider with this redirect URI:
  `<SUPABASE_URL>/auth/v1/callback`.
- An identity provider that sends the user's email, and a first and last name
  (`given_name` and `family_name`, or a full `name`).
- An issuer URL that Supabase Auth accepts. It must use HTTPS, must not be
  `localhost`, and must not resolve to a private or loopback address from where
  Supabase Auth runs. Supabase Auth has no setting to relax this, so an
  identity provider that is only reachable on an internal network cannot be
  registered under its internal address.
- The same issuer URL for browsers and for Supabase Auth. Identity providers
  put the URL the user logged in on into the token as its issuer, and Supabase
  Auth rejects a token whose issuer differs from the registered one.
- For the group mapping: the groups claim in the **ID token**. Supabase Auth
  reads the userinfo endpoint only when the provider issues no ID token.

To see all of this working before you touch your own setup, run the
[local example](#try-it-locally-with-docker-compose).

## 1. Register the provider in Supabase

Create the provider with the Supabase Auth admin API. The identifier always
starts with `custom:`.

```js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

await supabase.auth.admin.customProviders.createProvider({
  provider_type: "oidc",
  identifier: "custom:my-idp",
  name: "My identity provider",
  client_id: "shelf",
  client_secret: "...",
  issuer: "https://idp.example.com/realms/main",
  scopes: ["openid", "profile", "email", "groups"],
  // Copies the IdP's `groups` claim into the stored identity. Without it
  // Shelf sees no groups and the group mapping grants nothing.
  custom_claims_allowlist: ["groups"],
});
```

The same call is available over HTTP as
`POST <SUPABASE_URL>/auth/v1/admin/custom-providers` with the service role key.
On Supabase Cloud you can also use the dashboard (Authentication, Sign In /
Providers).

Then add both Shelf callbacks to Supabase's redirect allow list
(`GOTRUE_URI_ALLOW_LIST` when self-hosting):

- `<SERVER_URL>/oauth/callback` for the web app
- `<SERVER_URL>/oauth/callback/mobile` for the companion app

::: warning Email verification
Supabase only signs a user in when the identity provider marks the email as
verified (`email_verified: true`), or when email confirmations are turned off
(`GOTRUE_MAILER_AUTOCONFIRM=true`). If your provider does not send
`email_verified`, turn confirmations off.
:::

## 2. Configure Shelf

| Variable                  | Purpose                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_PROVIDER`           | The provider's identifier, for example `custom:my-idp`. Setting it turns the login on.                                                 |
| `OIDC_BUTTON_LABEL`       | Text of the login button. Defaults to "Log in with SSO".                                                                               |
| `OIDC_SCOPES`             | Optional. Space-separated scopes to request. When empty, the scopes stored on the provider in Supabase are used.                       |
| `OIDC_GROUPS_CLAIM`       | Name of the claim that carries the user's groups. Defaults to `groups`. It must be listed in the provider's `custom_claims_allowlist`. |
| `OIDC_WORKSPACE_MAPPINGS` | Optional. JSON that maps groups to workspace roles, see below.                                                                         |
| `DISABLE_SSO`             | Set to `true` to hide the domain-based SAML SSO if you only use the custom OIDC login.                                                 |
| `DISABLE_EMAIL_LOGIN`     | Set to `true` to hide password and one-time code login, which leaves single sign-on as the only way in.                                |

## 3. Map groups to workspaces

`OIDC_WORKSPACE_MAPPINGS` is a JSON array with one entry per workspace:

```json
[
  {
    "key": "it-department",
    "name": "IT Department",
    "currency": "EUR",
    "roles": {
      "ADMIN": ["it-admins"],
      "MANAGER": ["it-leads"],
      "SELF_SERVICE": ["it-staff"],
      "BASE": ["all-employees"]
    }
  }
]
```

| Field      | Meaning                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`      | Stable identifier of the entry: lowercase letters, digits, `-` and `_`. Shelf stores it on the workspace, so never change it once the workspace exists. |
| `name`     | Name the workspace is created with. Renaming the workspace in Shelf later is fine.                                                                      |
| `currency` | Optional currency of a newly created workspace (ISO code). Defaults to `USD`.                                                                           |
| `roles`    | For each role (`ADMIN`, `MANAGER`, `SELF_SERVICE`, `BASE`) the groups that hold it. Group names are compared without regard to case.                    |

On **every** login Shelf compares the user's groups with each entry:

- A user whose groups match gets the role. When several roles match, the most
  privileged one wins.
- A member whose groups no longer match any role of the entry loses access to
  that workspace at their next login. This includes members who were invited
  by hand: a mapped workspace is managed by the identity provider.
- The workspace is created the first time someone in one of the entry's
  `ADMIN` groups logs in. That person becomes the workspace **owner**. Until
  then, other members of the entry see the "pending assignment" page.
- The owner keeps the Owner role whatever their groups say. Ownership only
  changes through a transfer inside Shelf.

Shelf validates the JSON when the server starts and refuses to start with a
message that names the faulty field.

To hand an **existing** workspace over to an entry, set its key in the
database once:

```sql
UPDATE "Organization" SET "oidcMappingKey" = 'it-department' WHERE id = '<workspace id>';
```

## How accounts behave

- A user's first OIDC login creates their Shelf account. It is an SSO account:
  it has no password, cannot reset one, and has no personal workspace in the
  workspace switcher.
- Role changes take effect at the next login. A user who is removed from the
  identity provider keeps their current session until it ends, so also
  deactivate the user in Shelf when access has to end immediately.
- If the identity provider asserts the email of an existing email/password
  account, Supabase links the login to that account. The user keeps their data
  and can then sign in both ways.
- Supabase records every OAuth sign-in the same way. If you enable another
  OAuth provider in the same Supabase project, a user who holds identities
  from both is accepted with either; groups are always read from the custom
  provider's identity.
- While `OIDC_PROVIDER` is set, an SSO account is refused password and
  one-time code login even when `DISABLE_SSO` is `true`.
- The companion app's "Sign in with SSO" opens the same login, no separate
  configuration is needed.

## Try it locally with Docker Compose

The repository contains a runnable example in
[`apps/docs/sso/custom-oidc-example`](https://github.com/Shelf-nu/shelf.nu/tree/main/apps/docs/sso/custom-oidc-example):
Shelf with the custom OIDC login, the two Supabase services it needs,
PostgreSQL, and [Keycloak](https://www.keycloak.org) as the identity provider
with five test users. It needs no Supabase account and no existing identity
provider.

::: warning For a developer machine only
Every secret in the example is published in this repository and nothing is
backed up. Use it to try the login and as a reference for your own
configuration, not as a production setup.
:::

### Run it

```bash
git clone https://github.com/Shelf-nu/shelf.nu.git
cd shelf.nu/apps/docs/sso/custom-oidc-example

# Once: lets your browser find Keycloak under the name Supabase Auth uses.
echo '127.0.0.1 keycloak.shelf.internal' | sudo tee -a /etc/hosts

docker compose up --build
```

The first start builds Shelf from the checkout, which takes several minutes.
When the `shelf` container logs `Server started on port 3000`, open
`http://localhost:3000` and click **Log in with Keycloak**. Your browser warns
about Keycloak's certificate the first time, because it is issued by the
example's own certificate authority. Accept it once.

| URL                                    | What                                       |
| -------------------------------------- | ------------------------------------------ |
| `http://localhost:3000`                | Shelf                                      |
| `https://keycloak.shelf.internal:8443` | Keycloak admin console (`admin` / `admin`) |
| `http://localhost:8025`                | Mailpit, shows every email that is sent    |
| `http://localhost:8000`                | Supabase API (Auth and Storage), no UI     |

Ports 3000, 8000, 8443 and 8025 must be free. Use Chrome or Firefox: Safari
does not accept Shelf's `Secure` session cookie on plain `http://localhost`.

### Test users

All passwords are `test`. Keycloak keeps you signed in, so use a separate
private window for each user.

| User    | Keycloak group     | Result in Shelf                                        |
| ------- | ------------------ | ------------------------------------------------------ |
| `alice` | `shelf-admins`     | First login creates "Main Workspace", she is its Owner |
| `mona`  | `shelf-managers`   | Manager in "Main Workspace"                            |
| `bob`   | `shelf-staff`      | Self service in "Main Workspace", Base in "Warehouse"  |
| `wendy` | `warehouse-admins` | First login creates "Warehouse", she is its Owner      |
| `carol` | none               | The "pending assignment" page                          |

The groups are mapped by `OIDC_WORKSPACE_MAPPINGS` in `docker-compose.yml`.

Things to try:

1. Log in as `bob` before anyone else. He sees "pending assignment", because
   no administrator has created a workspace yet. Log in as `alice`, then as
   `bob` again.
2. In the Keycloak admin console (realm `shelf`, Users, `bob`, Groups) move
   `bob` to `shelf-managers`. After his next login he is a Manager.
3. Remove `mona` from all groups. Her next login takes her workspace away.
4. Remove `alice` from `shelf-admins`. She stays Owner.
5. Start Shelf with `DISABLE_EMAIL_LOGIN=true docker compose up -d shelf`.
   The login page shows only the Keycloak button.

To see what Supabase Auth stored for each user, and the resulting roles:

```bash
docker compose exec db psql -U postgres -c \
  "SELECT email, provider, identity_data -> 'custom_claims' FROM auth.identities"
docker compose exec db psql -U postgres -c \
  'SELECT u.email, o.name, uo.roles FROM "UserOrganization" uo
   JOIN "User" u ON u.id = uo."userId" JOIN "Organization" o ON o.id = uo."organizationId"'
```

`docker compose down -v` removes the example and its data.

### What is in the example

| File                        | Purpose                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`        | All services and their configuration. The Shelf variables of this guide are under `shelf`, the Supabase Auth settings under `auth`.      |
| `setup/setup.mjs`           | Step 1 of this guide over HTTP: registers Keycloak as `custom:keycloak` in Supabase Auth, and creates Shelf's storage buckets.           |
| `keycloak/shelf-realm.json` | The Keycloak realm: the client `shelf`, a mapper that adds the `groups` claim to the ID token, the groups and the users.                 |
| `gateway/Caddyfile`         | Serves Supabase Auth and Storage under one URL with the paths Shelf expects (`/auth/v1`, `/storage/v1`), and serves Keycloak over HTTPS. |
| `db/init.sql`               | The database roles and schemas that Supabase Auth and Storage expect, for a plain PostgreSQL image.                                      |

### What differs from a real deployment

Supabase Auth's rules for the issuer URL (see [Requirements](#requirements))
are written for an identity provider on the public internet. Running one on
your own machine takes three workarounds, none of which you need with a
provider that has a public HTTPS address:

- Keycloak is served as `https://keycloak.shelf.internal:8443` by the gateway,
  with a certificate from the gateway's own certificate authority. The `auth`
  container trusts that authority through `SSL_CERT_FILE`.
- The Compose network uses `203.0.113.0/24`, an address range reserved for
  documentation. Inside the `auth` container the Keycloak name therefore does
  not resolve to a private address.
- The `/etc/hosts` entry points the same name at your machine, so that your
  browser and Supabase Auth use one issuer URL.

Shelf's container shares the gateway's network, which makes
`http://localhost:8000` the Supabase URL for Shelf's server and for your
browser alike.

### Troubleshooting

| Symptom                                                                | Cause                                                                                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup` keeps logging "identity provider not ready"                    | Normal for the first minute while Keycloak starts. If it never stops, see `docker compose logs keycloak`.                                    |
| The Keycloak page does not load                                        | The `/etc/hosts` entry is missing.                                                                                                           |
| Back on Shelf with "Error getting user profile from external provider" | Supabase Auth rejected the ID token. `docker compose logs auth` names the reason, usually an issuer that differs from the registered one.    |
| Every user lands on "pending assignment"                               | The groups did not arrive. Run the first query above: `custom_claims` must contain `groups`. If not, the claim is missing from the ID token. |
| "Unverified email with custom:..." in `docker compose logs auth`       | The identity provider did not send `email_verified: true`. See the warning in step 1.                                                        |
