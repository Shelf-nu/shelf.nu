/**
 * Tests for the wiring of `OrgProvider`: that it lands through
 * `pickLandingOrg` (an inactive workspace is passed over) and that a refused
 * request re-reads `/api/mobile/me` through the 403 listener, at most once
 * per gap.
 *
 * Runs under `node --test`; the provider renders in a plain React test tree.
 * The helpers it uses (`pickLandingOrg`, the read tracker, the throttle, the
 * 403 listeners) run for real; only the network, auth, Sentry and device
 * storage are faked.
 *
 * @see {@link file://./org-context.tsx}
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, before, describe, it, mock } from "node:test";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import type { Organization } from "./api/types";
// The real 403 listeners, so the test fires refusals the way the API client
// does and the provider hears them through its real subscription.
import * as forbidden from "./api/forbidden";

/** What the fake `/me` answers with, set by each test. */
let meAnswer: {
  organizations: Organization[];
  lastSelectedOrganizationId: string | null;
} = { organizations: [], lastSelectedOrganizationId: null };
/** How many `/me` reads the provider made. */
let meReads = 0;

/** The answer a `/me` read gives. */
type MeResult = { data: unknown; error: string | null };
/**
 * When set, each `/me` read waits here until the test answers it, so a test
 * controls the order in which overlapping reads finish.
 */
let heldReads: ((result: MeResult) => void)[] | null = null;

/** The answer a successful `/me` read gives, from `meAnswer`. */
function meSuccess(): MeResult {
  return {
    data: { user: { id: "user-1", email: "test@example.com" }, ...meAnswer },
    error: null,
  };
}

/** A workspace as `/api/mobile/me` sends it. */
function org(id: string, inactive: boolean): Organization {
  return {
    id,
    name: id,
    type: "TEAM",
    roles: ["ADMIN"],
    barcodesEnabled: false,
    auditsEnabled: false,
    inactive,
    inactiveReason: inactive ? "lapsed" : null,
    inactiveMessage: inactive ? `${id} is inactive.` : null,
  };
}

// why: the API layer reaches the network through Supabase and SecureStore;
// `/me` is the one call the provider makes, answered from `meAnswer`.
mock.module(pathToFileURL(join(__dirname, "api.ts")).href, {
  namedExports: {
    api: {
      me: async () => {
        meReads += 1;
        const held = heldReads;
        if (held) return new Promise<MeResult>((resolve) => held.push(resolve));
        return meSuccess();
      },
    },
    onForbidden: forbidden.onForbidden,
  },
});

// why: the auth context reads the Supabase session from native storage; a
// signed-in user is all the provider needs.
mock.module(pathToFileURL(join(__dirname, "auth-context.tsx")).href, {
  namedExports: { useAuth: () => ({ user: AUTH_USER }) },
});

// why: Sentry is a native SDK; the provider only tags the scope.
mock.module(pathToFileURL(join(__dirname, "sentry.ts")).href, {
  namedExports: { setSentryUser: () => {} },
});

// why: AsyncStorage is a native module; this device has no saved choice.
mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    getItem: async () => null,
    setItem: async () => {},
  },
});

/** One stable user object, so the provider reads `/me` once per mount. */
const AUTH_USER = { id: "user-1" };

let orgContext: typeof import("./org-context");
before(async () => {
  orgContext = await import("./org-context");
});

/** Renders the provider and returns a handle to what it provides. */
async function renderProvider() {
  const latest: { current: ReturnType<typeof orgContext.useOrg> | null } = {
    current: null,
  };
  function Probe() {
    latest.current = orgContext.useOrg();
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      createElement(orgContext.OrgProvider, null, createElement(Probe))
    );
  });
  // Let the `/me` read and the device-storage read settle.
  await act(async () => {});
  return {
    org: () => latest.current!,
    unmount: () => act(() => renderer.unmount()),
  };
}

let mounted: Awaited<ReturnType<typeof renderProvider>> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  meReads = 0;
  heldReads = null;
});

describe("OrgProvider", () => {
  it("lands on the active workspace when the server's choice is inactive", async () => {
    meAnswer = {
      organizations: [org("lapsed-team", true), org("active-team", false)],
      lastSelectedOrganizationId: "lapsed-team",
    };

    mounted = await renderProvider();

    assert.equal(mounted.org().currentOrg?.id, "active-team");
    assert.equal(mounted.org().isLoading, false);
  });

  it("re-reads /me once for two refusals inside the gap", async () => {
    meAnswer = {
      organizations: [org("active-team", false)],
      lastSelectedOrganizationId: null,
    };
    mounted = await renderProvider();
    assert.equal(meReads, 1, "the first load");

    await act(async () => {
      forbidden.notifyForbidden();
      forbidden.notifyForbidden();
    });

    // The first refusal re-reads at once; the second falls inside the 15 s
    // gap and waits as the one trailing re-read, which unmounting cancels.
    assert.equal(meReads, 2);
  });

  it("shows the failure when a quiet re-read overtakes the first load and fails", async () => {
    meAnswer = {
      organizations: [org("active-team", false)],
      lastSelectedOrganizationId: null,
    };
    heldReads = [];
    const reads = heldReads;
    mounted = await renderProvider();
    assert.equal(mounted.org().isLoading, true, "the first load is waiting");

    // A refusal while the first load waits starts the quiet re-read.
    await act(async () => forbidden.notifyForbidden());
    assert.equal(reads.length, 2);

    // The quiet re-read fails, then the overtaken first load answers.
    await act(async () => reads[1]({ data: null, error: "Network error" }));
    await act(async () => reads[0](meSuccess()));

    // The person sees why nothing loaded, not "No workspace assigned".
    assert.equal(mounted.org().error, "Network error");
    assert.equal(mounted.org().isLoading, false);
  });
});
