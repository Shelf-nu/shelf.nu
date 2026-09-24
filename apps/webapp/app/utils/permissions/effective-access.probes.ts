/**
 * Effective-access probes: the characterization fixture for the role-policy
 * refactor.
 *
 * `buildEffectiveAccessSnapshot()` evaluates every role-shaped decision that
 * has a pure helper, for every role set, workspace toggle combination, booking
 * relationship and booking status that matters, and returns one plain object.
 * Its JSON is committed as `__snapshots__/effective-access.json`.
 *
 * The fixture is the proof that the refactor changes nothing it does not
 * announce: a probe's IMPLEMENTATION may move from an old helper to the new
 * policy API, but its KEY and its RECORDED VALUE may only change in the commit
 * that makes a listed fix (spec section 8.3 / 8.5), with the reason in the
 * commit body.
 *
 * @see {@link file://./effective-access.characterization.test.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { getDefaultModeForRole } from "~/modules/asset-index-settings/service.server";
import { isExplicitCheckoutRequired } from "~/modules/booking-settings/explicit-checkout";
import { getBookingOwnershipScope } from "~/modules/booking/utils.server";
import { INVITABLE_ROLES } from "~/modules/invite/roles";
import { resolveCustodianPickerScope } from "~/modules/team-member/service.server";
import { organizationRolesMap } from "~/routes/_layout+/settings.team";
import {
  bookingWriteScopeClause,
  resolveCanSeeAllBookings,
  validateBookingOwnership,
} from "~/utils/booking-authorization.server";
import {
  canRoleRemoveBookingAssets,
  canUserManageBookingAssets,
} from "~/utils/bookings";
import {
  ROLE_PRECEDENCE,
  SSO_ASSIGNABLE_ROLE_PRECEDENCE,
  resolveMostPrivilegedRole,
} from "~/utils/role-precedence";
import { isDemotion } from "~/utils/roles";
import {
  resolveCanSeeAllCustody,
  resolveEffectiveRole,
} from "~/utils/roles.server";
import { PermissionAction, PermissionEntity } from "./permission.data";
import { userHasPermission } from "./permission.validator.client";

const R = OrganizationRoles;
const SINGLE_ROLES = [R.OWNER, R.ADMIN, R.SELF_SERVICE, R.BASE] as const;

/** Every role set the fixture evaluates: singles, every ordered pair, empty, unknown. */
export const ROLE_SETS: string[][] = [
  ...SINGLE_ROLES.map((r) => [r]),
  ...SINGLE_ROLES.flatMap((a) =>
    SINGLE_ROLES.filter((b) => b !== a).map((b) => [a, b])
  ),
  [],
  ["UNKNOWN_ROLE"],
];

/** The four workspace visibility toggles, all 16 combinations. */
export const TOGGLE_COMBOS = Array.from({ length: 16 }, (_, i) => ({
  selfServiceCanSeeBookings: Boolean(i & 1),
  baseUserCanSeeBookings: Boolean(i & 2),
  selfServiceCanSeeCustody: Boolean(i & 4),
  baseUserCanSeeCustody: Boolean(i & 8),
}));

/** Caller vs booking relationships, each isolated from the other. */
export const RELATIONSHIPS = {
  custodianNotCreator: { creatorId: "someone-else", custodianUserId: "caller" },
  creatorNotCustodian: { creatorId: "caller", custodianUserId: "someone-else" },
  neither: { creatorId: "someone-else", custodianUserId: "someone-else" },
} as const;

export const BOOKING_STATUSES = [
  "DRAFT",
  "RESERVED",
  "ONGOING",
  "OVERDUE",
  "COMPLETE",
  "ARCHIVED",
  "CANCELLED",
] as const;

const key = (roles: string[]) => (roles.length ? roles.join("+") : "(none)");
const toggleKey = (t: (typeof TOGGLE_COMBOS)[number]) =>
  [
    t.selfServiceCanSeeBookings ? "ssB" : "",
    t.baseUserCanSeeBookings ? "baB" : "",
    t.selfServiceCanSeeCustody ? "ssC" : "",
    t.baseUserCanSeeCustody ? "baC" : "",
  ]
    .filter(Boolean)
    .join(",") || "none";

/** The effective role the WEB server uses for a membership. */
function webRole(roles: string[]) {
  return resolveEffectiveRole({
    userOrganizations: [
      { organization: { id: "org" }, roles: roles as OrganizationRoles[] },
    ],
    organizationId: "org",
  });
}

/** Runs a throwing guard and records whether it allowed the call. */
function outcome(fn: () => unknown): "allowed" | "denied" {
  try {
    fn();
    return "allowed";
  } catch {
    return "denied";
  }
}

/**
 * Builds the complete effective-access snapshot.
 *
 * @returns A JSON-serializable object keyed by decision id
 */
export function buildEffectiveAccessSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};

  // Matrix: every role set x entity x action (union semantics).
  snapshot.matrix = Object.fromEntries(
    ROLE_SETS.map((roles) => [
      key(roles),
      Object.fromEntries(
        Object.values(PermissionEntity).map((entity) => [
          entity,
          Object.values(PermissionAction).filter((action) =>
            userHasPermission({
              roles: roles as OrganizationRoles[],
              entity,
              action,
            })
          ),
        ])
      ),
    ])
  );

  // D-01: effective role, web server and mobile/client resolvers.
  snapshot["D-01"] = Object.fromEntries(
    ROLE_SETS.filter((r) => !r.includes("UNKNOWN_ROLE")).map((roles) => [
      key(roles),
      {
        web: webRole(roles),
        mobile: resolveMostPrivilegedRole(roles as OrganizationRoles[]),
      },
    ])
  );
  snapshot["D-01:precedence"] = ROLE_PRECEDENCE;
  snapshot["D-05:ssoAssignable"] = SSO_ASSIGNABLE_ROLE_PRECEDENCE;
  snapshot["D-04:invitable"] = INVITABLE_ROLES;
  snapshot["D-10:labels"] = organizationRolesMap;

  // D-02: ownership transfer on role change.
  snapshot["D-02"] = Object.fromEntries(
    SINGLE_ROLES.flatMap((from) =>
      SINGLE_ROLES.filter((to) => to !== from).map((to) => [
        `${from}->${to}`,
        isDemotion(from, to),
      ])
    )
  );

  // D-14 / D-28: visibility, every role set x toggles.
  for (const [id, fn] of [
    ["D-14", resolveCanSeeAllBookings],
    ["D-28", resolveCanSeeAllCustody],
  ] as const) {
    snapshot[id] = Object.fromEntries(
      ROLE_SETS.map((roles) => [
        key(roles),
        Object.fromEntries(
          TOGGLE_COMBOS.map((t) => [
            toggleKey(t),
            fn({ role: webRole(roles), currentOrganization: t }),
          ])
        ),
      ])
    );
  }

  // D-15: per-booking write gate, single roles x relationship x flags.
  snapshot["D-15"] = Object.fromEntries(
    SINGLE_ROLES.map((role) => [
      role,
      Object.fromEntries(
        Object.entries(RELATIONSHIPS).flatMap(([rel, booking]) =>
          [false, true].flatMap((checkCustodianOnly) =>
            [false, true].map((blockBaseEntirely) => [
              `${rel}|custodianOnly=${checkCustodianOnly}|blockBase=${blockBaseEntirely}`,
              outcome(() =>
                validateBookingOwnership({
                  booking,
                  userId: "caller",
                  role,
                  action: "probe",
                  checkCustodianOnly,
                  blockBaseEntirely,
                })
              ),
            ])
          )
        )
      ),
    ])
  );

  // D-16: query-side write scopes.
  snapshot["D-16"] = Object.fromEntries(
    SINGLE_ROLES.map((role) => [
      role,
      {
        writeScopeClause:
          bookingWriteScopeClause({ userId: "caller", role }) ?? null,
        bulkOwnershipScope: getBookingOwnershipScope({
          role,
          userId: "caller",
        }),
      },
    ])
  );

  // D-19 / D-29: custodian picker scopes.
  snapshot["D-19/D-29"] = Object.fromEntries(
    SINGLE_ROLES.map((role) => [
      role,
      Object.fromEntries(
        (
          ["custody-filter", "custody-assignment", "booking-custodian"] as const
        ).flatMap((purpose) =>
          [false, true].map((canSeeAllCustody) => [
            `${purpose}|seeAll=${canSeeAllCustody}`,
            resolveCustodianPickerScope({
              purpose,
              role,
              canSeeAllCustody,
              userId: "caller",
            }),
          ])
        )
      ),
    ])
  );

  // D-20: add items after DRAFT, as each call-site style passes the flag today.
  snapshot["D-20"] = Object.fromEntries(
    SINGLE_ROLES.map((role) => [
      role,
      Object.fromEntries(
        BOOKING_STATUSES.map((status) => [
          status,
          {
            selfServiceFlag: canUserManageBookingAssets(
              { status, from: null, to: null } as never,
              role === R.SELF_SERVICE
            ),
            restrictedFlag: canUserManageBookingAssets(
              { status, from: null, to: null } as never,
              role === R.SELF_SERVICE || role === R.BASE
            ),
          },
        ])
      ),
    ])
  );

  // D-21: removable statuses, every role set.
  snapshot["D-21"] = Object.fromEntries(
    ROLE_SETS.map((roles) => [
      key(roles),
      BOOKING_STATUSES.filter((status) =>
        canRoleRemoveBookingAssets({
          roles: roles as OrganizationRoles[],
          booking: { status } as never,
        })
      ),
    ])
  );

  // D-26: explicit check-out requirement.
  snapshot["D-26"] = Object.fromEntries(
    SINGLE_ROLES.map((role) => [
      role,
      Object.fromEntries(
        [false, true].flatMap((admin) =>
          [false, true].map((selfService) => [
            `admin=${admin}|selfService=${selfService}`,
            isExplicitCheckoutRequired({
              role,
              bookingSettings: {
                requireExplicitCheckoutForAdmin: admin,
                requireExplicitCheckoutForSelfService: selfService,
              },
            }),
          ])
        )
      ),
    ])
  );

  // D-33: default asset index mode.
  snapshot["D-33"] = Object.fromEntries(
    SINGLE_ROLES.map((role) => [role, getDefaultModeForRole(role)])
  );

  return snapshot;
}
