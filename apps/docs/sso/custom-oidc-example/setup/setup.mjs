// One-shot setup of the Supabase services for this example. Idempotent: it
// runs on every `docker compose up` and only changes what differs.
//
// 1. Registers Keycloak in Supabase Auth as a custom OIDC provider
//    (https://supabase.com/docs/guides/auth/custom-oauth-providers). This is
//    step 1 of ../custom-oidc.md, over the admin HTTP API.
// 2. Creates the storage buckets Shelf expects.
//
// Everything is read from the environment, see docker-compose.yml.

const {
  AUTH_URL,
  STORAGE_URL,
  SERVICE_ROLE_KEY,
  OIDC_PROVIDER,
  OIDC_NAME,
  OIDC_ISSUER,
  OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET,
  OIDC_SCOPES,
  OIDC_GROUPS_CLAIM,
} = process.env;

const headers = {
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

/** Buckets from Shelf's Supabase setup guide, and whether they are public. */
const BUCKETS = {
  "profile-pictures": true,
  assets: false,
  kits: false,
  files: true,
};

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, ok: response.ok, text };
}

async function expectOk(method, url, body) {
  const result = await request(method, url, body);
  if (!result.ok) {
    throw new Error(`${method} ${url} -> ${result.status}: ${result.text}`);
  }
  return result;
}

/** Waits until a service answers its health endpoint. */
async function waitFor(name, url, attempts = 60) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    console.log(`waiting for ${name} (${attempt})`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${name} did not become healthy`);
}

async function setupOidcProvider() {
  const provider = {
    name: OIDC_NAME,
    client_id: OIDC_CLIENT_ID,
    client_secret: OIDC_CLIENT_SECRET,
    issuer: OIDC_ISSUER,
    // The standard location, which is also what Supabase Auth assumes when
    // the field is left out. Sent anyway, because an update cannot clear a
    // different URL stored by an earlier run.
    discovery_url: `${OIDC_ISSUER}/.well-known/openid-configuration`,
    scopes: OIDC_SCOPES.split(/\s+/).filter(Boolean),
    // Copies the groups claim of the ID token into the stored identity, where
    // Shelf reads it to map groups to workspace roles.
    custom_claims_allowlist: [OIDC_GROUPS_CLAIM],
    pkce_enabled: true,
    enabled: true,
  };

  const url = `${AUTH_URL}/admin/custom-providers`;
  const existing = await request("GET", `${url}/${OIDC_PROVIDER}`);

  if (existing.status === 404) {
    await expectOk("POST", url, {
      provider_type: "oidc",
      identifier: OIDC_PROVIDER,
      ...provider,
    });
    console.log(`created provider ${OIDC_PROVIDER}`);
    return;
  }
  if (!existing.ok) {
    throw new Error(`GET provider -> ${existing.status}: ${existing.text}`);
  }

  await expectOk("PUT", `${url}/${OIDC_PROVIDER}`, provider);
  console.log(`updated provider ${OIDC_PROVIDER}`);
}

async function setupBuckets() {
  await waitFor("storage", `${STORAGE_URL}/status`, 30);

  for (const [id, isPublic] of Object.entries(BUCKETS)) {
    const existing = await request("GET", `${STORAGE_URL}/bucket/${id}`);
    if (existing.ok) {
      await expectOk("PUT", `${STORAGE_URL}/bucket/${id}`, {
        public: isPublic,
      });
      console.log(`bucket ${id} exists`);
      continue;
    }
    await expectOk("POST", `${STORAGE_URL}/bucket`, {
      id,
      name: id,
      public: isPublic,
    });
    console.log(`created bucket ${id}`);
  }
}

await waitFor("auth", `${AUTH_URL}/health`);

// Supabase Auth fetches the issuer's discovery document when a provider is
// saved, so this fails until Keycloak has imported its realm and is serving.
for (let attempt = 1; ; attempt++) {
  try {
    await setupOidcProvider();
    break;
  } catch (error) {
    if (attempt >= 60) throw error;
    console.log(`identity provider not ready (${attempt}): ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

// The login under test does not need file storage, so a storage problem must
// not keep Shelf from starting. Uploads will fail until it is fixed.
try {
  await setupBuckets();
} catch (error) {
  console.warn(`WARNING: storage buckets not set up: ${error.message}`);
}
