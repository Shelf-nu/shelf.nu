# Local Shibboleth v5 Test IdP (for Shelf SAML SSO)

A disposable, local Shibboleth Identity Provider to develop and test Shelf's SAML
SSO (brokered by Supabase) end-to-end, without a real university IdP. Backed by
OpenLDAP with 4 seeded users covering Shelf's 3 roles + a no-group user, releasing
the attributes Shelf consumes, with a persistent NameID.

**This is a test rig, not production.** Checked-in "secrets" (LDAP admin password,
persistent-ID salt, user passwords) are throwaway. The IdP's own signing/encryption
keys are baked into the `i2incommon/shib-idp` image and are never mounted or committed.

> **New session picking this up?** Read [Quick start](#quick-start) top to bottom —
> it goes from a fresh clone to a working `carol` login. The rest of the doc is
> reference. The two things that will waste your time if you skip them: the host
> **clock must be NTP-synced** (see [Gotchas](#gotchas)) and Supabase's
> **"Allow encrypted SAML Assertions"** must be on (see [Encryption](#encryption)).

## Key facts / values [#](#key-facts)

| Thing                        | Value                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| IdP image                    | `i2incommon/shib-idp:5.2.3_20260618_rocky9_multiarch` (v5, Tomcat 11, **port 443**, arm64-native) |
| LDAP image                   | `osixia/openldap:1.5.0` (arm64-native; `bitnami/openldap` is paywalled, `osixia` works)           |
| IdP entityID                 | `https://localhost/idp/shibboleth`                                                                |
| IdP scope / test domain      | `example.edu`                                                                                     |
| Shelf SP (Supabase) entityID | `https://wlkiilcvuycnnlzdvvws.supabase.co/auth/v1/sso/saml/metadata`                              |
| Supabase project ref (dev)   | `wlkiilcvuycnnlzdvvws` (project "shelf-local-three")                                              |
| Attribute-mapping preset     | `apps/webapp/sso/shibboleth-attributes.json` (in this repo)                                       |

## Quick start [#](#quick-start)

Prerequisites: Docker running, the `supabase` CLI logged in, and **an NTP-synced
host clock** (`date -u` must match real UTC — a drifted Docker/Mac clock makes every
login fail with `IssueInstant expired`).

```sh
cd tooling/shibboleth-test-idp

# 1. Fetch Shelf's SP metadata so the IdP can trust + encrypt to it.
#    (Requires Supabase "Allow encrypted SAML Assertions" ON — see §Encryption.)
curl -sk "https://wlkiilcvuycnnlzdvvws.supabase.co/auth/v1/sso/saml/metadata?download=true" \
  -o idp-home/conf/supabase-sp-metadata.xml

# 2. Boot LDAP + IdP.
docker compose up -d
#    Wait until healthy (IdP rebuilds its war on boot, ~10-15s):
until [ "$(curl -sk https://localhost/idp/shibboleth -o /dev/null -w '%{http_code}')" = 200 ]; do sleep 2; done

# 3. Export the IdP metadata for Supabase.
curl -sk https://localhost/idp/shibboleth -o idp-home/idp-metadata-out.xml

# 4. Register (or update) the provider in Supabase — hand it the FILE, not a URL
#    (the IdP is on localhost with a self-signed cert; Supabase can't fetch it).
supabase sso add --type saml --project-ref wlkiilcvuycnnlzdvvws \
  --metadata-file "$PWD/idp-home/idp-metadata-out.xml" \
  --attribute-mapping-file "$PWD/../../apps/webapp/sso/shibboleth-attributes.json" \
  --domains example.edu
#    (already registered? use `supabase sso list` to find the id, then
#     `supabase sso update <id> ...`, or remove + re-add.)
```

Then do the [Shelf side](#shelf-side) (point Shelf at this project + map the groups),
and [test](#test) by logging in as `carol` / `carolpass`.

## Up / down [#](#up-down)

```sh
docker compose up -d        # boot (LDAP healthcheck gates the IdP)
docker compose logs -f idp  # watch boot logs
docker compose down         # stop + remove (LDAP is NOT persisted — reseeded from ldap/init.ldif every boot)
```

## Test users [#](#test-users)

Seeded by `ldap/init.ldif` (base DN `dc=idptestbed`). Emails are `<uid>@example.edu`.

| Username | Password    | Shelf role   | `isMemberOf` (the `groups` claim)                                              |
| -------- | ----------- | ------------ | ------------------------------------------------------------------------------ |
| `carol`  | `carolpass` | ADMIN        | `cn=admins,ou=groups,dc=idptestbed` + `cn=engineering,ou=groups,dc=idptestbed` |
| `alice`  | `alicepass` | SELF_SERVICE | `cn=engineering,ou=groups,dc=idptestbed`                                       |
| `bob`    | `bobpass`   | BASE         | `cn=library-users,ou=groups,dc=idptestbed`                                     |
| `dan`    | `danpass`   | (none)       | _(none — exercises the `/sso-pending-assignment` path)_                        |

Each user also carries `eduPersonEntitlement` (`urn:mace:example.edu:shelf:<role>`) and
`eduPersonScopedAffiliation` (`staff@`/`student@`/`guest@example.edu`) so you can test
all three group strategies (see [Testing other strategies](#other-strategies)).

## Encryption [#](#encryption)

Shelf's SP publishes **no encryption key by default** — a Shibboleth IdP that tries to
encrypt then aborts with `InvalidSecurityConfiguration` **before the login page even
shows**. Two ways to fix; this rig uses both belt-and-suspenders:

1. **Supabase side (the real fix):** enable **"Allow encrypted SAML Assertions"** on the
   project. Supabase then publishes an encryption cert in its SP metadata, and the IdP
   encrypts automatically. This is what production clients rely on — they configure nothing.
   After enabling it, **re-fetch** `supabase-sp-metadata.xml` (Quick start step 1) so the IdP
   sees the new key.
2. **IdP side (fallback):** `idp.encryption.optional = true` in `idp-home/conf/idp.properties`
   — "encrypt if the SP has a key, else send unencrypted." Set here so the rig works whether
   or not the setting above is on.

## Shelf side [#](#shelf-side)

The IdP + Supabase registration only get you an authenticated session. To land a user in a
workspace with a role, do this in Shelf (same as onboarding a real client):

1. Point local Shelf's `.env` at the **shelf-local-three** project (`wlkiilcvuycnnlzdvvws`), run `pnpm webapp:dev`.
2. On a TEAM workspace, enable SSO and set `SsoDetails.domain = example.edu`.
3. In the workspace SSO settings, map the groups (isMemberOf strategy):
   - Administrator → `cn=admins,ou=groups,dc=idptestbed`
   - Self service → `cn=engineering,ou=groups,dc=idptestbed`
   - Base → `cn=library-users,ou=groups,dc=idptestbed`

## Test [#](#test)

Go to `/sso-login`, enter `example.edu`, click through the self-signed cert warning
**promptly**, log in as `carol` / `carolpass` (username is the uid, not the email).
Expected: carol lands as **Administrator**; alice → Self service; bob → Base; dan →
pending-assignment. Do it in one quick pass — the response is only valid for 90s (see Gotchas).

### Testing other strategies [#](#other-strategies)

The default mapping (`shibboleth-attributes.json`) sources `groups` from `isMemberOf`. To
test `eduPersonEntitlement` or `eduPersonScopedAffiliation`, `supabase sso update` the provider
with the `groups` source swapped to `…1.1.1.7` or `…1.1.1.9`, and change the `SsoDetails` values
to match (`urn:mace:example.edu:shelf:admin` or `staff@example.edu`). Shelf's side is identical.

### Multi-valued groups (bug supabase/auth#2332) [#](#multivalued)

**Confirmed working:** Supabase captures ALL values of a multi-valued attribute, regardless
of position. Verified by reordering carol's `isMemberOf` so `cn=admins` is the **second**
value — she still resolved to ADMIN. No single-value fallback needed.

## Verify attribute release (`aacli.sh`) [#](#aacli)

`aacli.sh` hits the IdP's local resolver-test endpoint over HTTPS, so it needs a Java trust
store for the container's self-signed TLS cert (`/opt/certs/idp-default.crt` — different from
the SAML certs in metadata). One-time per container lifetime:

```sh
docker compose exec idp bash -c \
  "keytool -importcert -noprompt -alias idptls -file /opt/certs/idp-default.crt \
     -keystore /tmp/aacli-truststore.jks -storepass changeit"
```

Then per user:

```sh
docker compose exec \
  -e JAVA_OPTS="-Djavax.net.ssl.trustStore=/tmp/aacli-truststore.jks -Djavax.net.ssl.trustStorePassword=changeit -Djavax.net.ssl.trustStoreType=PKCS12" \
  idp /opt/shibboleth-idp/bin/aacli.sh -u https://localhost/idp -k \
  -n carol -r https://wlkiilcvuycnnlzdvvws.supabase.co/auth/v1/sso/saml/metadata --saml2
```

(swap `-n carol` for alice/bob/dan). Passing the trust store via `JAVA_OPTS` system properties
is what works here — aacli's own `-ts`/`-tp` flags did not. A pass = a `<saml2:Assertion>` with a
persistent `<saml2:NameID>` and the expected attributes (6 for carol/alice/bob; dan omits the group ones).

## How it works — notes [#](#how-it-works)

**eduPerson-schema workaround.** Stock OpenLDAP lacks the eduPerson/eduMember schemas, so
group/affiliation/entitlement values are stashed in standard `inetOrgPerson` attributes and
**renamed** to the canonical IDs in `idp-home/conf/attribute-resolver.xml`: `title` →
`eduPersonScopedAffiliation`, `description` → `isMemberOf` (multi-valued), `businessCategory` →
`eduPersonEntitlement`. `isMemberOf` also needs a custom SAML transcoding rule
(`idp-home/conf/attributes/custom/isMemberOf.properties`) — the image's bundled rule files cover
the other 5 attributes but not `isMemberOf` (unbundled eduMember schema); without it the attribute
resolves internally but has no SAML2 encoder and vanishes from the assertion. (A **real** client
running Grouper releases `isMemberOf` natively and needs none of this — it's purely a test-rig hack.)

**Static IdP metadata.** `/idp/shibboleth` serves the static `idp-home/metadata/idp-metadata.xml`
(mounted read-only) — it does **not** regenerate from `idp.properties`. If you change `idp.entityID`,
`idp.scope`, or an endpoint path, hand-edit that file to match (URL/entityID/scope **text** only —
never the base64 `<ds:X509Certificate>` blocks; they're the image's real public certs). The 3 embedded
certs' CN/SAN read `idp.example.org` (cosmetic; SAML signature validation ignores CN/SAN).

## Gotchas [#](#gotchas)

- **🕐 Host clock must be NTP-synced.** Supabase rejects a response whose `IssueInstant` is
  > 90 seconds old (`response IssueInstant expired`). The IdP stamps `IssueInstant` from the host
  > clock (the container inherits it), so a Mac/Docker clock even ~90s behind real time makes EVERY
  > login fail — instantly, no matter how fast you click. Check with `date -u` vs an external source
  > (`curl -sI https://google.com | grep -i date`). This cost hours once; it's the first thing to check.
- **Encryption** — see [§Encryption](#encryption). `InvalidSecurityConfiguration` / no login page = this.
- **Self-signed TLS on :443.** The cert is `CN=idp.example.org` (baked in the image), so browsers/curl
  need "proceed"/`-k`. Register with Supabase via `--metadata-file`, never a metadata URL.
- **`localhost` only.** The exported metadata's endpoints point at `https://localhost/idp/...` — usable
  only from the machine running Docker. No tunnel is needed (SAML is browser-mediated; Supabase never
  connects to the IdP — it only validates the assertion the browser POSTs back).
- **LDAP isn't persisted** — every `up` reseeds from `ldap/init.ldif`.
- **Persistent-ID salt** (`saml-nameid.properties`) is a throwaway; changing it changes every user's
  NameID.
- **SP entityID is hardcoded** to `wlkiilcvuycnnlzdvvws` in `attribute-filter.xml` +
  `metadata-providers.xml` + the Quick-start commands. If you point at a different Supabase project,
  update all of them.

## Teardown [#](#teardown)

```sh
docker compose down
# remove the test provider from the dev project when done:
supabase sso list --project-ref wlkiilcvuycnnlzdvvws
supabase sso remove <provider-id> --project-ref wlkiilcvuycnnlzdvvws
```

## Files [#](#files)

```
tooling/shibboleth-test-idp/
├── docker-compose.yml               # ldap + idp services
├── ldap/init.ldif                   # seeds ou=People/groups + carol/alice/bob/dan
├── idp-home/
│   ├── conf/                        # mounted read-write over the image's conf/
│   │   ├── idp.properties           # entityID, scope, encryption.optional, persistentId
│   │   ├── ldap.properties          # LDAP connection
│   │   ├── saml-nameid.xml/.properties  # persistent NameID generator + salt
│   │   ├── attribute-resolver.xml   # 6 attributes from the myLDAP connector (+ eduPerson rename hack)
│   │   ├── attribute-filter.xml     # release policy scoped to the Shelf SP entityID
│   │   ├── metadata-providers.xml   # trusts supabase-sp-metadata.xml
│   │   ├── attributes/custom/isMemberOf.properties  # custom SAML encoder (see notes)
│   │   └── supabase-sp-metadata.xml # fetched at Quick-start step 1 (gitignored)
│   ├── metadata/idp-metadata.xml    # static IdP metadata served at /idp/shibboleth
│   └── idp-metadata-out.xml         # exported for Supabase (gitignored)
├── .gitignore
└── README.md
```
