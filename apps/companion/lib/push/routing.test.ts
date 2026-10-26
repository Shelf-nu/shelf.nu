/**
 * Tests for push tap routing.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./routing.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nextTapStep,
  resolvePushRoute,
  type PushPayload,
  type PushRoute,
} from "./routing";

/** A payload as the server sends it, with the fields a test cares about. */
function payload(overrides: Partial<PushPayload> = {}): PushPayload {
  return {
    url: "/bookings/bk_1?orgId=org_a",
    category: "bookings",
    organizationId: "org_a",
    ...overrides,
  };
}

test("a booking push opens the booking in the Bookings tab", () => {
  assert.deepEqual(resolvePushRoute(payload()), {
    tabRoot: "/(tabs)/bookings",
    href: "/(tabs)/bookings/bk_1",
    organizationId: "org_a",
  });
});

test("an audit push opens the audit, from its overview path or its bare path", () => {
  const expected = {
    tabRoot: "/(tabs)/audits",
    href: "/(tabs)/audits/au_1",
    organizationId: "org_a",
  };
  assert.deepEqual(
    resolvePushRoute(
      payload({ url: "/audits/au_1/overview?orgId=org_a", category: "audits" })
    ),
    expected
  );
  assert.deepEqual(
    resolvePushRoute(payload({ url: "/audits/au_1", category: "audits" })),
    expected
  );
});

test("an asset push opens the asset, however deep the web path is", () => {
  const expected = {
    tabRoot: "/(tabs)/assets",
    href: "/(tabs)/assets/as_1",
    organizationId: "org_a",
  };
  const category = "stockAndReminders";
  assert.deepEqual(
    resolvePushRoute(payload({ url: "/assets/as_1?orgId=org_a", category })),
    expected
  );
  assert.deepEqual(
    resolvePushRoute(payload({ url: "/assets/as_1/overview", category })),
    expected
  );
});

test("a kit push opens the kit inside the Assets tab", () => {
  const expected = {
    tabRoot: "/(tabs)/assets",
    href: "/(tabs)/assets/kits/kt_1",
    organizationId: "org_a",
  };
  assert.deepEqual(resolvePushRoute(payload({ url: "/kits/kt_1" })), expected);
  assert.deepEqual(
    resolvePushRoute(payload({ url: "/assets/kits/kt_1" })),
    expected
  );
});

test("the workspace comes from ?orgId= when the payload has no organizationId", () => {
  assert.deepEqual(
    resolvePushRoute({ url: "/bookings/bk_1?orgId=org_b&tab=assets" }),
    {
      tabRoot: "/(tabs)/bookings",
      href: "/(tabs)/bookings/bk_1",
      organizationId: "org_b",
    }
  );
});

test("the payload's organizationId wins over the path's ?orgId=", () => {
  assert.equal(
    resolvePushRoute(
      payload({ url: "/bookings/bk_1?orgId=org_b", organizationId: "org_a" })
    )?.organizationId,
    "org_a"
  );
});

test("a push that names no workspace still routes, with a null workspace", () => {
  assert.deepEqual(resolvePushRoute({ url: "/bookings/bk_1" }), {
    tabRoot: "/(tabs)/bookings",
    href: "/(tabs)/bookings/bk_1",
    organizationId: null,
  });
});

test("an absolute URL routes by its path", () => {
  assert.equal(
    resolvePushRoute(payload({ url: "https://app.shelf.nu/bookings/bk_9#x" }))
      ?.href,
    "/(tabs)/bookings/bk_9"
  );
});

test("a list path opens that tab's list, in the workspace from ?orgId=", () => {
  assert.deepEqual(resolvePushRoute({ url: "/bookings?orgId=org_b" }), {
    tabRoot: "/(tabs)/bookings",
    href: null,
    organizationId: "org_b",
  });
  assert.deepEqual(resolvePushRoute({ url: "/audits?orgId=org_b" }), {
    tabRoot: "/(tabs)/audits",
    href: null,
    organizationId: "org_b",
  });
  assert.deepEqual(resolvePushRoute({ url: "/assets?orgId=org_b" }), {
    tabRoot: "/(tabs)/assets",
    href: null,
    organizationId: "org_b",
  });
});

test("a kit list path opens the Assets list, as a universal link does", () => {
  for (const url of ["/kits", "/assets/kits"]) {
    assert.deepEqual(
      resolvePushRoute(payload({ url })),
      { tabRoot: "/(tabs)/assets", href: null, organizationId: "org_a" },
      url
    );
  }
});

test("a path that names no native screen resolves to null", () => {
  for (const url of [
    "/locations/lc_1",
    "/locations",
    "/",
    "",
    "/settings/general",
  ]) {
    assert.equal(resolvePushRoute(payload({ url })), null, url);
  }
});

test("data without a string url resolves to null", () => {
  for (const data of [
    null,
    undefined,
    "/bookings/bk_1",
    {},
    { url: 42 },
    { url: "   " },
  ]) {
    assert.equal(resolvePushRoute(data), null, JSON.stringify(data));
  }
});

test("a push never opens a screen that is not a detail", () => {
  for (const url of [
    "/assets/new?qrId=q1",
    "/assets/edit",
    "/assets/link-qr",
    "/bookings/new",
    "/bookings/edit",
    "/bookings/add-assets",
    "/audits/scan",
    "/audits/asset/as_1",
    "/audits/kit/kt_1",
  ]) {
    assert.equal(resolvePushRoute(payload({ url })), null, url);
  }
});

test("a push to the scanner or a QR code opens nothing", () => {
  for (const url of ["/scanner", "/scan", "/qr/qr_1"]) {
    assert.equal(resolvePushRoute(payload({ url })), null, url);
  }
});

test("a custom-scheme url routes like the web path it names", () => {
  assert.deepEqual(resolvePushRoute({ url: "shelf://bookings/bk_1" }), {
    tabRoot: "/(tabs)/bookings",
    href: "/(tabs)/bookings/bk_1",
    organizationId: null,
  });
});

const BOOKING_IN_B: PushRoute = {
  tabRoot: "/(tabs)/bookings",
  href: "/(tabs)/bookings/bk_1",
  organizationId: "org_b",
};

const ORGS = [{ id: "org_a" }, { id: "org_b" }];

/** Everything ready, in workspace A, with the booking in workspace B pending. */
const READY = {
  pending: BOOKING_IN_B,
  authLoading: false,
  hasSession: true,
  orgsLoading: false,
  inTabs: true,
  organizations: ORGS,
  currentOrgId: "org_a",
};

test("with no tap pending there is nothing to do", () => {
  assert.deepEqual(nextTapStep({ ...READY, pending: null }), { kind: "none" });
});

test("a tap waits for the session, the workspaces and the tabs", () => {
  assert.deepEqual(nextTapStep({ ...READY, authLoading: true }), {
    kind: "wait",
  });
  assert.deepEqual(nextTapStep({ ...READY, orgsLoading: true }), {
    kind: "wait",
  });
  assert.deepEqual(nextTapStep({ ...READY, inTabs: false }), {
    kind: "wait",
  });
});

test("a tap with nobody signed in is dropped", () => {
  assert.deepEqual(
    nextTapStep({ ...READY, hasSession: false, inTabs: false }),
    { kind: "drop" }
  );
});

test("a tap for another of the person's workspaces switches to it first", () => {
  assert.deepEqual(nextTapStep(READY), {
    kind: "switch-org",
    organization: { id: "org_b" },
  });
});

test("once the workspace matches, the tap opens its screen", () => {
  assert.deepEqual(nextTapStep({ ...READY, currentOrgId: "org_b" }), {
    kind: "open",
    tabRoot: "/(tabs)/bookings",
    href: "/(tabs)/bookings/bk_1",
  });
});

test("a tap for a workspace the person left is dropped", () => {
  assert.deepEqual(
    nextTapStep({ ...READY, organizations: [{ id: "org_a" }] }),
    { kind: "drop" }
  );
});

test("a tap naming no workspace opens the screen as is", () => {
  assert.deepEqual(
    nextTapStep({
      ...READY,
      pending: { ...BOOKING_IN_B, organizationId: null },
    }),
    {
      kind: "open",
      tabRoot: "/(tabs)/bookings",
      href: "/(tabs)/bookings/bk_1",
    }
  );
});
