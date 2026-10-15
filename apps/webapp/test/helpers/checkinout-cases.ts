/**
 * Case builders for the check-out / check-in characterization.
 *
 * Pure data: every check-out/check-in path (loader and action listed
 * separately, across the web quick/overview/partial/fulfil surfaces and the
 * mobile quick/partial/fulfil endpoints), the role sets, booking
 * relationships, statuses and workspace variants each path is evaluated
 * against, and the rows a fake database hands the real guards.
 *
 * Route tests that pin one path's cell build their fixtures from here too, so
 * a focused test and the characterization can never describe two different
 * bookings. The relationship keys and user ids match the `RELATIONSHIPS` of the
 * effective-access probes; they are declared again here because the probes
 * module imports server modules a route test must not load.
 *
 * @see {@link file://../routes-tests/checkinout-paths.characterization.test.ts}
 */
import {
  BookingStatus,
  OrganizationRoles,
  OrganizationType,
} from "@prisma/client";
import { createBookingSettings } from "@factories";

/** The user every case acts as. */
export const CALLER_ID = "caller";
/** The user who holds whatever link the caller does not. */
export const OTHER_USER_ID = "someone-else";
export const ORG_ID = "org-1";
export const BOOKING_ID = "booking-1";

const R = OrganizationRoles;

/**
 * The five roles alone, plus mixed memberships in both orders. Web paths
 * resolve the most privileged role and mobile paths mostly do too, but a path
 * that still reads `roles[0]` answers the two orders differently.
 */
export const CHECKINOUT_ROLE_SETS: OrganizationRoles[][] = [
  [R.OWNER],
  [R.ADMIN],
  [R.MANAGER],
  [R.SELF_SERVICE],
  [R.BASE],
  [R.SELF_SERVICE, R.ADMIN],
  [R.ADMIN, R.SELF_SERVICE],
  [R.SELF_SERVICE, R.MANAGER],
  [R.MANAGER, R.SELF_SERVICE],
];

/**
 * The key a role set is recorded under.
 *
 * @param roles - A membership's roles, in stored order
 * @returns The roles joined with `+`, order preserved
 */
export function roleSetKey(roles: readonly string[]): string {
  return roles.join("+");
}

/**
 * The caller's relationship to the booking, each link isolated from the other,
 * so "creator" and "custodian" are verified independently.
 */
export const BOOKING_RELATIONSHIPS = {
  custodianNotCreator: { creatorId: OTHER_USER_ID, custodianUserId: CALLER_ID },
  creatorNotCustodian: { creatorId: CALLER_ID, custodianUserId: OTHER_USER_ID },
  neither: { creatorId: OTHER_USER_ID, custodianUserId: OTHER_USER_ID },
} as const;

export type BookingRelationship = keyof typeof BOOKING_RELATIONSHIPS;

const RELATIONSHIP_KEYS = Object.keys(
  BOOKING_RELATIONSHIPS
) as BookingRelationship[];

/** Every booking status the schema defines. */
export const CHECKINOUT_STATUSES = Object.values(BookingStatus);

/** The four workspace visibility toggles. */
export type WorkspaceToggles = {
  selfServiceCanSeeBookings: boolean;
  baseUserCanSeeBookings: boolean;
  selfServiceCanSeeCustody: boolean;
  baseUserCanSeeCustody: boolean;
};

/** The visibility toggles all off, and all on. */
export const WORKSPACE_VARIANTS = {
  "toggles-off": {
    selfServiceCanSeeBookings: false,
    baseUserCanSeeBookings: false,
    selfServiceCanSeeCustody: false,
    baseUserCanSeeCustody: false,
  },
  "toggles-on": {
    selfServiceCanSeeBookings: true,
    baseUserCanSeeBookings: true,
    selfServiceCanSeeCustody: true,
    baseUserCanSeeCustody: true,
  },
} satisfies Record<string, WorkspaceToggles>;

export type WorkspaceVariant = keyof typeof WORKSPACE_VARIANTS;

/**
 * The workspace's explicit-scan switches. Each variant turns on both the
 * check-out and the check-in switch for one role, so one variant serves both
 * directions.
 */
export const EXPLICIT_VARIANTS = {
  "explicit-off": {},
  "explicit-admin": {
    requireExplicitCheckoutForAdmin: true,
    requireExplicitCheckinForAdmin: true,
  },
  "explicit-selfService": {
    requireExplicitCheckoutForSelfService: true,
    requireExplicitCheckinForSelfService: true,
  },
} as const;

export type ExplicitVariant = keyof typeof EXPLICIT_VARIANTS;

/** A workspace variant and an explicit-scan variant, recorded as one key. */
export type CheckinoutVariant = `${WorkspaceVariant}|${ExplicitVariant}`;

/** The first dependency each path calls once all of its guards pass. */
export type CheckinoutSentinel =
  | "checkoutBooking"
  | "checkinBooking"
  | "checkoutRemainingAssets"
  | "checkoutAssets"
  | "checkinAssets"
  | "partialCheckoutBooking"
  | "partialCheckinBooking"
  | "getDetailedPartialCheckoutData"
  | "getDetailedPartialCheckinData"
  | "getOutstandingModelRequests"
  | "fulfilAndCheckOut";

export type CheckinoutPathKey =
  | "web:overview:checkOut"
  | "web:overview:checkIn"
  | "web:overview:checkOutRemaining"
  | "web:overview:partial-checkin"
  | "web:overview:partial-checkout"
  | "web:checkout-assets:loader"
  | "web:checkout-assets:action"
  | "web:checkin-assets:loader"
  | "web:checkin-assets:action"
  | "web:fulfil-and-checkout:loader"
  | "web:fulfil-and-checkout:action"
  | "mobile:checkin"
  | "mobile:checkout"
  | "mobile:partial-checkin"
  | "mobile:partial-checkout"
  | "mobile:fulfil-and-checkout";

/** One check-out/check-in path: a loader or an action, in one direction. */
export type CheckinoutPath = {
  key: CheckinoutPathKey;
  /** The human-readable surface this path belongs to, e.g. "Web partial check-out page (loader)". */
  specRow: string;
  surface: "web" | "mobile";
  kind: "loader" | "action";
  direction: "checkout" | "checkin";
  sentinel: CheckinoutSentinel;
  /** The path's guard reads the explicit-scan switches, or hands them on. */
  readsExplicit: boolean;
};

/** Every check-out/check-in path; the two quick rows are split by direction. */
export const CHECKINOUT_PATHS: readonly CheckinoutPath[] = [
  {
    key: "web:overview:checkOut",
    specRow: "Web quick check-out / check-in",
    surface: "web",
    kind: "action",
    direction: "checkout",
    sentinel: "checkoutBooking",
    readsExplicit: true,
  },
  {
    key: "web:overview:checkIn",
    specRow: "Web quick check-out / check-in",
    surface: "web",
    kind: "action",
    direction: "checkin",
    sentinel: "checkinBooking",
    readsExplicit: true,
  },
  {
    key: "web:overview:checkOutRemaining",
    specRow: "Web checkOutRemaining",
    surface: "web",
    kind: "action",
    direction: "checkout",
    sentinel: "checkoutRemainingAssets",
    readsExplicit: true,
  },
  {
    key: "web:overview:partial-checkin",
    specRow: "Web overview partial-checkin intent",
    surface: "web",
    kind: "action",
    direction: "checkin",
    sentinel: "checkinAssets",
    readsExplicit: false,
  },
  {
    key: "web:overview:partial-checkout",
    specRow: "Web overview partial-checkout intent",
    surface: "web",
    kind: "action",
    direction: "checkout",
    sentinel: "checkoutAssets",
    readsExplicit: false,
  },
  {
    key: "web:checkout-assets:loader",
    specRow: "Web partial check-out page (loader)",
    surface: "web",
    kind: "loader",
    direction: "checkout",
    sentinel: "getDetailedPartialCheckoutData",
    readsExplicit: false,
  },
  {
    key: "web:checkout-assets:action",
    specRow: "Web partial check-out page (action)",
    surface: "web",
    kind: "action",
    direction: "checkout",
    sentinel: "checkoutAssets",
    readsExplicit: false,
  },
  {
    key: "web:checkin-assets:loader",
    specRow: "Web partial check-in page (loader)",
    surface: "web",
    kind: "loader",
    direction: "checkin",
    sentinel: "getDetailedPartialCheckinData",
    readsExplicit: false,
  },
  {
    key: "web:checkin-assets:action",
    specRow: "Web partial check-in page (action)",
    surface: "web",
    kind: "action",
    direction: "checkin",
    sentinel: "checkinAssets",
    readsExplicit: false,
  },
  {
    key: "web:fulfil-and-checkout:loader",
    specRow: "Web fulfil-and-checkout (loader)",
    surface: "web",
    kind: "loader",
    direction: "checkout",
    sentinel: "getOutstandingModelRequests",
    readsExplicit: false,
  },
  {
    key: "web:fulfil-and-checkout:action",
    specRow: "Web fulfil-and-checkout (action)",
    surface: "web",
    kind: "action",
    direction: "checkout",
    sentinel: "fulfilAndCheckOut",
    readsExplicit: true,
  },
  {
    key: "mobile:checkin",
    specRow: "Mobile quick check-in / check-out",
    surface: "mobile",
    kind: "action",
    direction: "checkin",
    sentinel: "checkinBooking",
    readsExplicit: true,
  },
  {
    key: "mobile:checkout",
    specRow: "Mobile quick check-in / check-out",
    surface: "mobile",
    kind: "action",
    direction: "checkout",
    sentinel: "checkoutBooking",
    readsExplicit: true,
  },
  {
    key: "mobile:partial-checkin",
    specRow: "Mobile partial check-in",
    surface: "mobile",
    kind: "action",
    direction: "checkin",
    sentinel: "partialCheckinBooking",
    readsExplicit: false,
  },
  {
    key: "mobile:partial-checkout",
    specRow: "Mobile partial check-out",
    surface: "mobile",
    kind: "action",
    direction: "checkout",
    sentinel: "partialCheckoutBooking",
    readsExplicit: false,
  },
  {
    key: "mobile:fulfil-and-checkout",
    specRow: "Mobile fulfil-and-checkout",
    surface: "mobile",
    kind: "action",
    direction: "checkout",
    sentinel: "fulfilAndCheckOut",
    readsExplicit: true,
  },
];

/** One evaluation of one path. */
export type CheckinoutCase = {
  variant: CheckinoutVariant;
  roles: OrganizationRoles[];
  relationship: BookingRelationship;
  status: BookingStatus;
  workspace: WorkspaceToggles;
  explicit: ExplicitVariant;
};

/**
 * Every case a path is evaluated against.
 *
 * @param path - The path; its `readsExplicit` adds the explicit-scan variants
 * @returns The cases, in the order their outcomes are recorded
 */
export function checkinoutCases(
  path: Pick<CheckinoutPath, "readsExplicit">
): CheckinoutCase[] {
  const cases: CheckinoutCase[] = [];
  const add = (
    variant: CheckinoutVariant,
    relationships: readonly BookingRelationship[]
  ) => {
    const [toggles, explicit] = variant.split("|") as [
      WorkspaceVariant,
      ExplicitVariant,
    ];
    for (const roles of CHECKINOUT_ROLE_SETS) {
      for (const relationship of relationships) {
        for (const status of CHECKINOUT_STATUSES) {
          cases.push({
            variant,
            roles,
            relationship,
            status,
            workspace: WORKSPACE_VARIANTS[toggles],
            explicit,
          });
        }
      }
    }
  };

  add("toggles-off|explicit-off", RELATIONSHIP_KEYS);
  // Seeing someone else's booking must never let a member act on it.
  add("toggles-on|explicit-off", ["neither"]);
  if (path.readsExplicit) {
    // The caller holds the booking, so ownership passes and only the
    // explicit-scan rule can move the outcome.
    add("toggles-off|explicit-admin", ["custodianNotCreator"]);
    add("toggles-off|explicit-selfService", ["custodianNotCreator"]);
  }
  return cases;
}

/** The caller's user row. */
export function checkinoutCaller() {
  return {
    id: CALLER_ID,
    email: "caller@example.com",
    firstName: "Casey",
    lastName: "Caller",
    displayName: null,
  };
}

/** The workspace: a TEAM workspace, so bookings are available. */
export function checkinoutOrganization() {
  return {
    id: ORG_ID,
    name: "Characterization workspace",
    type: OrganizationType.TEAM,
    barcodesEnabled: false,
    auditsEnabled: false,
  };
}

/**
 * What `getSelectedOrganization` answers on web: the caller's membership and
 * the workspace with the case's visibility toggles.
 *
 * @param c - The case; only `roles` and `workspace` are read
 */
export function checkinoutSelectedOrganization(
  c: Pick<CheckinoutCase, "roles" | "workspace">
) {
  const organization = { ...checkinoutOrganization(), ...c.workspace };
  return {
    organizationId: ORG_ID,
    organizations: [organization],
    userOrganizations: [{ organization: { id: ORG_ID }, roles: c.roles }],
    currentOrganization: organization,
    cookieRefreshNeeded: false,
  };
}

/**
 * The caller's `UserOrganization` row, as the mobile helpers read it: membership,
 * roles, and the workspace flags selected alongside them.
 *
 * @param c - The case; only `roles` and `workspace` are read
 */
export function checkinoutMembership(
  c: Pick<CheckinoutCase, "roles" | "workspace">
) {
  return {
    id: "membership-1",
    userId: CALLER_ID,
    organizationId: ORG_ID,
    roles: c.roles,
    organization: { ...checkinoutOrganization(), ...c.workspace },
  };
}

/**
 * The booking under test: the case's status and relationship, no assets, and
 * one open model reservation (so the fulfil screen has work to do once its
 * guards pass).
 *
 * @param c - The case; only `relationship` and `status` are read
 */
export function checkinoutBooking(
  c: Pick<CheckinoutCase, "relationship" | "status">
) {
  return {
    id: BOOKING_ID,
    organizationId: ORG_ID,
    name: "Characterization booking",
    status: c.status,
    ...BOOKING_RELATIONSHIPS[c.relationship],
    custodianTeamMemberId: null,
    from: new Date("2026-01-01T09:00:00Z"),
    to: new Date("2099-01-02T09:00:00Z"),
    bookingAssets: [],
    modelRequests: [
      {
        id: "model-request-1",
        bookingId: BOOKING_ID,
        assetModelId: "model-1",
        quantity: 1,
        fulfilledQuantity: 0,
        fulfilledAt: null,
        assetModel: { id: "model-1", name: "Characterization model" },
      },
    ],
  };
}

/**
 * The workspace's booking settings with one explicit-scan variant applied.
 *
 * @param explicit - Which role's explicit-scan switches are on
 */
export function checkinoutSettings(explicit: ExplicitVariant) {
  return createBookingSettings(EXPLICIT_VARIANTS[explicit]);
}

/** Working hours switched off: they never decide a check-out or check-in. */
export function checkinoutWorkingHours() {
  return {
    id: "working-hours-1",
    organizationId: ORG_ID,
    enabled: false,
    weeklySchedule: {},
    overrides: [],
  };
}
