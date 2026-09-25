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
import { getBookingOwnershipScope } from "~/modules/booking/utils.server";
import { resolveCalendarVisibility } from "~/modules/calendar-subscription/service.server";
import { INVITABLE_ROLES } from "~/modules/invite/roles";
import { resolveCustodianPickerScope } from "~/modules/team-member/service.server";
import { organizationRolesMap } from "~/routes/_layout+/settings.team";
import {
  assertCanDeleteBooking,
  assertCanDownloadBookingDocuments,
  bookingWriteScopeClause,
  isSelfServiceOrBaseRole,
  validateBookingOwnership,
} from "~/utils/booking-authorization.server";
import {
  bookingCustodianIsSelf,
  canScanAddBookingItems,
  mayRemoveBookingItems,
} from "~/utils/bookings";
import {
  ROLE_PRECEDENCE,
  SSO_ASSIGNABLE_ROLE_PRECEDENCE,
  resolveMostPrivilegedRole,
} from "~/utils/role-precedence";
import { isDemotion } from "~/utils/roles";
import {
  isOrganizationOwner,
  resolveEffectiveRole,
} from "~/utils/roles.server";
import { userHasCustodyViewPermission } from "./custody-and-bookings-permissions.validator.client";
import { PermissionAction, PermissionEntity } from "./permission.data";
import { userHasPermission } from "./permission.validator.client";
import {
  canManageBookingItems,
  canPartialCheckInOut,
  isExplicitScanRequired,
  resolveRole,
  resolveRoleAccess,
} from "./role-access";
import { visibleSettingsTabs } from "./settings-tabs";

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

/** Workspace toggles all off. */
const OFF = TOGGLE_COMBOS[0];

/** The access a membership resolves to under the given toggles. */
function accessFor(
  roles: string[],
  workspace: (typeof TOGGLE_COMBOS)[number] = OFF
) {
  return resolveRoleAccess({ roles, workspace });
}

/**
 * `access` with custody visibility forced to `seeAll`, for probes keyed on the
 * visibility flag rather than on a toggle combination.
 */
function withCustodySeeAll(
  access: ReturnType<typeof accessFor>,
  seeAll: boolean
) {
  return { ...access, custody: { ...access.custody, seeAll } };
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

// ---------------------------------------------------------------------------
// Mixed-role baseline (Task 1c)
//
// Probes for every decision whose answer for a MIXED membership depends on
// how the call site reads the role: positionally (`roles[0]`, mobile
// `getMobileUserContext().role`), as "any role held" (`useUserRoleHelper`
// flags, companion `isRestrictedRole`), or as the effective role. Inline call
// sites are reproduced here with the inputs the call site derives; each probe
// cites its lines. A task that migrates a call site rewrites its probe to
// reproduce the migrated code, and the fixture diff must equal the key's row in
// the plan's Task 1c mapping table.
// ---------------------------------------------------------------------------

const E = PermissionEntity;
const A = PermissionAction;

/** Statuses a booking can still be changed in. */
const OPEN_STATUSES = ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"] as const;

/** Statuses whose items can no longer change. */
const CLOSED_STATUSES: readonly string[] = [
  "COMPLETE",
  "ARCHIVED",
  "CANCELLED",
];

/** Delete rules compare the status with DRAFT only: one draft, one not. */
const DRAFT_OR_NOT = ["DRAFT", "RESERVED"] as const;

/** Whether the caller is the booking's custodian. */
const CUSTODIAN_CASES = ["caller", "someoneElse"] as const;

/** Whether the caller holds the booking (edit form / assets column wording). */
const HOLDER_CASES = ["holder", "notHolder"] as const;

/** A bulk selection, by how many of its bookings are drafts. */
const SELECTION_CASES = ["allDraft", "someDraft", "noneDraft"] as const;

/** The caller's effective role on web membership screens (reached with teamMember:update). */
const CALLER_ROLES = [R.OWNER, R.ADMIN] as const;

type RelationshipName = keyof typeof RELATIONSHIPS;
const RELATIONSHIP_NAMES = Object.keys(RELATIONSHIPS) as RelationshipName[];

/** The four combinations of the two booking see-toggles (custody toggles off). */
const BOOKING_TOGGLES = TOGGLE_COMBOS.filter(
  (t) => !t.selfServiceCanSeeCustody && !t.baseUserCanSeeCustody
);

/** A role change moves nothing: what every SSO transition does today. */
const NO_TRANSFER = { ownership: false, bookingsCreatedForOthers: false };

/** How a route answered: allowed, or the first check that refused. */
type Verdict =
  | "allowed"
  | "denied:gate"
  | "denied:owner"
  | "denied:self"
  | "denied:custodian"
  | "denied:status";

/**
 * Evaluates `fn` for every `ROLE_SETS` entry, keyed like the rest of the
 * fixture. Every mixed-role probe is keyed by role set first.
 */
function perRoleSet<T>(
  fn: (roles: OrganizationRoles[]) => T
): Record<string, T> {
  return Object.fromEntries(
    ROLE_SETS.map((roles) => [key(roles), fn(roles as OrganizationRoles[])])
  );
}

/** Evaluates `fn` for each named case. */
function perCase<C extends string, T>(
  cases: readonly C[],
  fn: (c: C) => T
): Record<C, T> {
  return Object.fromEntries(cases.map((c) => [c, fn(c)])) as Record<C, T>;
}

/** Evaluates `fn` for each toggle combination, keyed by `toggleKey`. */
function perToggle<T>(
  toggles: typeof TOGGLE_COMBOS,
  fn: (t: (typeof TOGGLE_COMBOS)[number]) => T
): Record<string, T> {
  return Object.fromEntries(toggles.map((t) => [toggleKey(t), fn(t)]));
}

/**
 * The matrix grant `requirePermission` / `requireMobilePermission` check: the
 * union over every held role, ADMIN/OWNER allow-all (`hasPermission` →
 * `roleHasPermission`).
 */
function can(
  roles: OrganizationRoles[],
  entity: PermissionEntity,
  action: PermissionAction | PermissionAction[]
): boolean {
  return userHasPermission({ roles, entity, action });
}

/** The first check that refuses, in call-site order; "allowed" when none does. */
function firstRefusal(
  checks: ReadonlyArray<readonly [Verdict, () => boolean]>
): Verdict {
  for (const [verdict, refuses] of checks) {
    if (refuses()) return verdict;
  }
  return "allowed";
}

/** Whether a throwing guard refuses. */
function throws(fn: () => unknown): boolean {
  return outcome(fn) === "denied";
}

/** Whether the membership holds any of `set`: Prisma `roles: { hasSome: set }`. */
function holdsAny(
  roles: OrganizationRoles[],
  set: OrganizationRoles[]
): boolean {
  return roles.some((role) => set.includes(role));
}

/**
 * `useUserRoleHelper()`'s flags (`hooks/user-user-role-helper.ts:14-31`). Each
 * is true when the role is held ANYWHERE in the membership. An empty
 * membership stands in for the loading state (`roles` undefined): every flag
 * is false either way.
 */
function hookFlags(roles: OrganizationRoles[]) {
  const isAdministrator = roles.includes(R.ADMIN);
  const isOwner = roles.includes(R.OWNER);
  const isSelfService = roles.includes(R.SELF_SERVICE);
  const isBase = roles.includes(R.BASE);
  return {
    isAdministrator,
    isOwner,
    isAdministratorOrOwner: isAdministrator || isOwner,
    isSelfService,
    isBase,
    isBaseOrSelfService: isBase || isSelfService,
  };
}

/**
 * The per-booking write gate as its call sites run it. `checkCustodianOnly`
 * selects the booking-documents rule (`assertCanDownloadBookingDocuments`),
 * otherwise creator-or-custodian (`validateBookingOwnership`).
 * `blockBaseEntirely` is the extend path: the `booking:extend` grant over every
 * held role is checked first (`extendBooking`).
 *
 * @throws when the gate refuses
 */
function bookingWriteGate({
  roles,
  booking,
  checkCustodianOnly,
  blockBaseEntirely,
}: {
  roles: string[];
  booking: { creatorId: string | null; custodianUserId: string | null };
  checkCustodianOnly: boolean;
  blockBaseEntirely: boolean;
}): void {
  const access = accessFor(roles);
  if (
    blockBaseEntirely &&
    !can(roles as OrganizationRoles[], E.booking, A.extend)
  ) {
    throw new Error("no booking:extend grant");
  }
  if (checkCustodianOnly) {
    assertCanDownloadBookingDocuments({
      access,
      booking,
      userId: "caller",
      action: "probe",
    });
  } else {
    validateBookingOwnership({
      access,
      booking,
      userId: "caller",
      action: "probe",
    });
  }
}

/** `organizationRolesMap[role]`, `null` where the map has no entry. */
function roleLabel(role: string | undefined): string | null {
  return role ? organizationRolesMap[role] ?? null : null;
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

  // D-14: booking visibility, every role set x toggles.
  snapshot["D-14"] = Object.fromEntries(
    ROLE_SETS.map((roles) => [
      key(roles),
      Object.fromEntries(
        TOGGLE_COMBOS.map((t) => [
          toggleKey(t),
          accessFor(roles, t).bookings.seeAll,
        ])
      ),
    ])
  );

  // D-28: custody visibility, every role set x toggles.
  snapshot["D-28"] = Object.fromEntries(
    ROLE_SETS.map((roles) => [
      key(roles),
      Object.fromEntries(
        TOGGLE_COMBOS.map((t) => [
          toggleKey(t),
          accessFor(roles, t).custody.seeAll,
        ])
      ),
    ])
  );

  // D-15: per-booking write gate, single roles x relationship x flags.
  // The key's flags name the two call-site variants the gate has:
  // `custodianOnly` is the booking-documents rule (documentsForOthers), and
  // `blockBase` is the extend path, where the matrix grant `booking:extend`
  // gates before ownership.
  snapshot["D-15"] = Object.fromEntries(
    SINGLE_ROLES.map((role) => [
      role,
      Object.fromEntries(
        Object.entries(RELATIONSHIPS).flatMap(([rel, booking]) =>
          [false, true].flatMap((checkCustodianOnly) =>
            [false, true].map((blockBaseEntirely) => [
              `${rel}|custodianOnly=${checkCustodianOnly}|blockBase=${blockBaseEntirely}`,
              outcome(() =>
                bookingWriteGate({
                  roles: [role],
                  booking,
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
          bookingWriteScopeClause({
            userId: "caller",
            access: accessFor([role]),
          }) ?? null,
        bulkOwnershipScope: getBookingOwnershipScope({
          access: accessFor([role]),
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
            // The `seeAll=` half of a booking-custodian key never influences
            // it: that purpose reads the role's booking policy only.
            resolveCustodianPickerScope({
              purpose,
              access: withCustodySeeAll(accessFor([role]), canSeeAllCustody),
              userId: "caller",
            }),
          ])
        )
      ),
    ])
  );

  // D-20: add items after DRAFT. The two keys name the two call-site rules:
  // `selfServiceFlag` is the scan page (bookings.scanAddAfterDraft), and
  // `restrictedFlag` is manage-assets / manage-kits / mobile add
  // (bookings.manageItemsAfterDraft).
  snapshot["D-20"] = Object.fromEntries(
    SINGLE_ROLES.map((role) => [
      role,
      Object.fromEntries(
        BOOKING_STATUSES.map((status) => [
          status,
          {
            selfServiceFlag: canScanAddBookingItems({
              access: accessFor([role]),
              bookingStatus: status,
            }),
            restrictedFlag: canManageBookingItems({
              access: accessFor([role]),
              bookingStatus: status,
            }),
          },
        ])
      ),
    ])
  );

  // D-21: removable statuses, every role set: the booking:update grant (which
  // denies an empty or unknown membership) and the policy's statuses.
  snapshot["D-21"] = Object.fromEntries(
    ROLE_SETS.map((roles) => [
      key(roles),
      BOOKING_STATUSES.filter((status) =>
        mayRemoveBookingItems({
          canUpdateBooking: userHasPermission({
            roles: roles as OrganizationRoles[],
            entity: PermissionEntity.booking,
            action: PermissionAction.update,
          }),
          access: accessFor(roles),
          bookingStatus: status,
        })
      ),
    ])
  );

  // D-22: delete a booking, single roles x relationship x status
  // (`assertCanDeleteBooking`: ownership, then the policy's drafts-only rule).
  snapshot["D-22"] = Object.fromEntries(
    SINGLE_ROLES.map((role) => [
      role,
      Object.fromEntries(
        Object.entries(RELATIONSHIPS).flatMap(([rel, booking]) =>
          BOOKING_STATUSES.map((status) => [
            `${rel}|${status}`,
            outcome(() =>
              assertCanDeleteBooking({
                access: accessFor([role]),
                booking: { ...booking, status },
                userId: "caller",
              })
            ),
          ])
        )
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
            isExplicitScanRequired({
              access: accessFor([role]),
              settings: {
                requireExplicitCheckoutForAdmin: admin,
                requireExplicitCheckoutForSelfService: selfService,
                requireExplicitCheckinForAdmin: false,
                requireExplicitCheckinForSelfService: false,
              },
              direction: "checkout",
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

  // ===================== Bookings: Task 4b =====================

  // B9:D-14: "view other bookings" link in the adjust-quantity dialog:
  // `useRoleAccess().bookings.seeAll`
  // (components/booking/adjust-booking-asset-quantity-dialog.tsx:113).
  // Recorded per booking see-toggle pair, since the migrated gate reads them.
  snapshot["B9:D-14:adjust-quantity-link"] = perRoleSet((roles) =>
    perToggle(BOOKING_TOGGLES, (t) => accessFor(roles, t).bookings.seeAll)
  );

  // B9:F3: calendar feed visibility, the member's effective role folded with
  // the workspace toggles (modules/calendar-subscription/service.server.ts:298-315,
  // `resolveCalendarVisibility`). Calls the real function, so the probe
  // tracks its body without a rewrite.
  snapshot["B9:F3:calendar-feed"] = perRoleSet((roles) =>
    perToggle(TOGGLE_COMBOS, (t) =>
      resolveCalendarVisibility({ roles, organization: t })
    )
  );

  // ===================== Bookings: Task 4c =====================

  // B9:D-15: the web write gate for every membership (web callers pass the
  // `access` requirePermission resolves, and the membership's roles for the
  // extend grant).
  snapshot["B9:D-15:web-server"] = perRoleSet((roles) =>
    Object.fromEntries(
      RELATIONSHIP_NAMES.flatMap((rel) =>
        [false, true].flatMap((checkCustodianOnly) =>
          [false, true].map((blockBaseEntirely) => [
            `${rel}|custodianOnly=${checkCustodianOnly}|blockBase=${blockBaseEntirely}`,
            outcome(() =>
              bookingWriteGate({
                roles,
                booking: RELATIONSHIPS[rel],
                checkCustodianOnly,
                blockBaseEntirely,
              })
            ),
          ])
        )
      )
    )
  );

  // B9:D-16: web query-side write scopes for every membership.
  snapshot["B9:D-16:web-server"] = perRoleSet((roles) => ({
    writeScopeClause:
      bookingWriteScopeClause({ userId: "caller", access: accessFor(roles) }) ??
      null,
    bulkOwnershipScope: getBookingOwnershipScope({
      access: accessFor(roles),
      userId: "caller",
    }),
  }));

  // B9:D-15: mobile archive (routes/api+/mobile+/bookings.archive.ts: gate
  // booking:archive, then ownership on the context's `access`).
  snapshot["B9:D-15:mobile-archive"] = perRoleSet((roles) =>
    perCase(RELATIONSHIP_NAMES, (rel) =>
      firstRefusal([
        ["denied:gate", () => !can(roles, E.booking, A.archive)],
        [
          "denied:owner",
          () =>
            throws(() =>
              validateBookingOwnership({
                booking: RELATIONSHIPS[rel],
                userId: "caller",
                access: accessFor(roles),
                action: "archive",
              })
            ),
        ],
      ])
    )
  );

  // B9:D-15: mobile cancel (bookings.cancel.ts: gate booking:cancel, then
  // ownership on the context's `access`).
  snapshot["B9:D-15:mobile-cancel"] = perRoleSet((roles) =>
    perCase(RELATIONSHIP_NAMES, (rel) =>
      firstRefusal([
        ["denied:gate", () => !can(roles, E.booking, A.cancel)],
        [
          "denied:owner",
          () =>
            throws(() =>
              validateBookingOwnership({
                booking: RELATIONSHIPS[rel],
                userId: "caller",
                access: accessFor(roles),
                action: "cancel",
              })
            ),
        ],
      ])
    )
  );

  // B9:D-22: mobile delete (bookings.delete.ts: gate booking:delete, then
  // `assertCanDeleteBooking` on the context's `access`: ownership first, then
  // the policy's drafts-only rule).
  snapshot["B9:D-22:mobile-delete"] = perRoleSet((roles) => {
    const access = accessFor(roles);
    return Object.fromEntries(
      RELATIONSHIP_NAMES.flatMap((rel) =>
        DRAFT_OR_NOT.map((status) => [
          `${rel}|${status}`,
          firstRefusal([
            ["denied:gate", () => !can(roles, E.booking, A.delete)],
            [
              "denied:owner",
              () =>
                throws(() =>
                  validateBookingOwnership({
                    booking: RELATIONSHIPS[rel],
                    userId: "caller",
                    access,
                    action: "delete",
                  })
                ),
            ],
            [
              "denied:status",
              () =>
                throws(() =>
                  assertCanDeleteBooking({
                    access,
                    booking: { ...RELATIONSHIPS[rel], status },
                    userId: "caller",
                  })
                ),
            ],
          ]),
        ])
      )
    );
  });

  // B9:D-15/D-19: mobile duplicate (bookings.duplicate.ts: gate
  // booking:create, ownership on the context's `access`, then a caller who may
  // only book for themself must be the source booking's custodian).
  snapshot["B9:D-15/D-19:mobile-duplicate"] = perRoleSet((roles) => {
    const access = accessFor(roles);
    return perCase(RELATIONSHIP_NAMES, (rel) =>
      firstRefusal([
        ["denied:gate", () => !can(roles, E.booking, A.create)],
        [
          "denied:owner",
          () =>
            throws(() =>
              validateBookingOwnership({
                booking: RELATIONSHIPS[rel],
                userId: "caller",
                access,
                action: "duplicate",
              })
            ),
        ],
        [
          "denied:custodian",
          () =>
            bookingCustodianIsSelf(access) &&
            RELATIONSHIPS[rel].custodianUserId !== "caller",
        ],
      ])
    );
  });

  // B9:D-15: mobile model requests (bookings.$bookingId.model-requests.ts).
  // Gate booking:update; a caller who does not write every booking must be
  // the custodian.
  snapshot["B9:D-15:mobile-model-requests"] = perRoleSet((roles) => {
    const restricted = !accessFor(roles).bookings.writeAll;
    return perCase(RELATIONSHIP_NAMES, (rel) =>
      firstRefusal([
        ["denied:gate", () => !can(roles, E.booking, A.update)],
        [
          "denied:owner",
          () => restricted && RELATIONSHIPS[rel].custodianUserId !== "caller",
        ],
      ])
    );
  });

  // B9:D-16: mobile available-models booking lookup (bookings.available-models.ts;
  // no matrix gate): a caller who does not write every booking is limited to
  // bookings in its custody scope.
  snapshot["B9:D-16:mobile-available-models"] = perRoleSet((roles) =>
    accessFor(roles).bookings.writeAll ? "workspace" : "custodian-scope"
  );

  // B9:D-15: web "can see actions" on a booking,
  // `useRoleAccess().bookings.writeAll || holder`: editBookingForm
  // (components/booking/forms/edit-booking-form.tsx) and bookingAssetsColumn
  // (components/booking/booking-assets-column.tsx).
  snapshot["B9:D-15:web-form-actions"] = perRoleSet((roles) => {
    const { writeAll } = accessFor(roles).bookings;
    return perCase(HOLDER_CASES, (holder) => {
      const visible = writeAll || holder === "holder";
      return { editBookingForm: visible, bookingAssetsColumn: visible };
    });
  });

  // ===================== Bookings: Task 4d =====================

  // B9:D-19/D-29: picker scopes for every membership on the web, all read
  // from the membership's access.
  snapshot["B9:D-19/D-29:web-server"] = perRoleSet((roles) =>
    Object.fromEntries(
      (
        ["custody-filter", "custody-assignment", "booking-custodian"] as const
      ).flatMap((purpose) =>
        [false, true].map((canSeeAllCustody) => [
          `${purpose}|seeAll=${canSeeAllCustody}`,
          resolveCustodianPickerScope({
            purpose,
            access: withCustodySeeAll(accessFor(roles), canSeeAllCustody),
            userId: "caller",
          }),
        ])
      )
    )
  );

  // B9:D-19: mobile booking-custodian picker (routes/api+/mobile+/team-members.ts,
  // on the context's `access`).
  snapshot["B9:D-19:mobile-team-members"] = perRoleSet(
    (roles) =>
      resolveCustodianPickerScope({
        purpose: "booking-custodian",
        access: accessFor(roles),
        userId: "caller",
      }).mode
  );

  // B9:D-19: mobile custodian self-lock on create (bookings.create.ts: gate
  // booking:create, then `bookingCustodianIsSelf` on the context's `access`)
  // and update (bookings.update.ts: gate booking:update, then the same lock;
  // the booking itself is the caller's, so the custodian-only check passes
  // and only the lock is probed).
  snapshot["B9:D-19:mobile-self-lock"] = perRoleSet((roles) => {
    const restricted = bookingCustodianIsSelf(accessFor(roles));
    const lock = (action: PermissionAction, custodian: string) =>
      firstRefusal([
        ["denied:gate", () => !can(roles, E.booking, action)],
        ["denied:self", () => restricted && custodian !== "caller"],
      ]);
    return perCase(CUSTODIAN_CASES, (custodian) => ({
      create: lock(A.create, custodian),
      update: lock(A.update, custodian),
    }));
  });

  // B9:D-15: mobile update / reserve on another member's booking: a caller
  // who does not write every booking must be the custodian. update
  // bookings.update.ts (gate booking:update); reserve bookings.reserve.ts
  // (gate booking:create).
  snapshot["B9:D-15:mobile-update-reserve"] = perRoleSet((roles) => {
    const restricted = !accessFor(roles).bookings.writeAll;
    const custodianOnly = (rel: RelationshipName, action: PermissionAction) =>
      firstRefusal([
        ["denied:gate", () => !can(roles, E.booking, action)],
        [
          "denied:owner",
          () => restricted && RELATIONSHIPS[rel].custodianUserId !== "caller",
        ],
      ]);
    return perCase(RELATIONSHIP_NAMES, (rel) => ({
      update: custodianOnly(rel, A.update),
      reserve: custodianOnly(rel, A.create),
    }));
  });

  // B9:D-25: mobile time-limit bypass, `access.policy.bookings.bypassTimeLimits`
  // on the context's `access` (bookings.create.ts, bookings.update.ts,
  // bookings.reserve.ts).
  snapshot["B9:D-25:mobile-time-bypass"] = perRoleSet((roles) => {
    const bypass = accessFor(roles).policy.bookings.bypassTimeLimits;
    const gated = (action: PermissionAction) =>
      can(roles, E.booking, action) ? bypass : "denied:gate";
    return {
      create: gated(A.create),
      update: gated(A.update),
      reserve: gated(A.create),
    };
  });

  // B9:D-46: does a reservation made by this member trigger the org broadcast?
  // web: bookings.$bookingId.overview.tsx reserve intent (~1692-1705) passes
  // requirePermission's isSelfServiceOrBase (effective role); mobile:
  // bookings.reserve.ts passes the context's isSelfServiceOrBase, the same
  // effective role, which the policy's `reservationAlertsAdmins` answers.
  snapshot["B9:D-46:reservation-trigger"] = perRoleSet((roles) => ({
    web: isSelfServiceOrBaseRole(webRole(roles)),
    mobile: can(roles, E.booking, A.create)
      ? accessFor(roles).policy.notifications.reservationAlertsAdmins
      : "denied:gate",
  }));

  // B9:D-19: web custodian field lock / seed, `bookingCustodianIsSelf` on
  // `useRoleAccess()`: edit-booking-form.tsx, new-booking-form.tsx,
  // components/assets/assets-index/create-booking-for-selected-assets-dialog.tsx.
  snapshot["B9:D-19:web-custodian-lock"] = perRoleSet((roles) => {
    const locked = bookingCustodianIsSelf(accessFor(roles));
    return {
      editBookingForm: locked,
      newBookingForm: locked,
      createBookingForSelectedAssets: locked,
    };
  });

  // ===================== Bookings: Task 4e =====================

  // B9:D-20: web add-items rule for every membership, per call-site rule:
  // `selfServiceFlag` is the scan page (`canScanAddBookingItems`),
  // `restrictedFlag` is manage-assets / manage-kits / the fulfil loader
  // (`canManageBookingItems`), both on the request's `access`.
  snapshot["B9:D-20:web-server"] = perRoleSet((roles) => {
    const access = accessFor(roles);
    return perCase(BOOKING_STATUSES, (status) => ({
      selfServiceFlag: canScanAddBookingItems({
        access,
        bookingStatus: status,
      }),
      restrictedFlag: canManageBookingItems({ access, bookingStatus: status }),
    }));
  });

  // B9:D-15/D-20: mobile add-scanned-assets (bookings.add-scanned-assets.ts).
  // Gate booking:update; a caller who does not write every booking must be
  // the custodian; then the manage-items rule on the context's `access`.
  snapshot["B9:D-15/D-20:mobile-add-scanned"] = perRoleSet((roles) => {
    const access = accessFor(roles);
    return Object.fromEntries(
      CUSTODIAN_CASES.flatMap((custodian) =>
        BOOKING_STATUSES.map((status) => [
          `custodian=${custodian}|${status}`,
          firstRefusal([
            ["denied:gate", () => !can(roles, E.booking, A.update)],
            [
              "denied:owner",
              () => !access.bookings.writeAll && custodian !== "caller",
            ],
            [
              "denied:status",
              () => !canManageBookingItems({ access, bookingStatus: status }),
            ],
          ]),
        ])
      )
    );
  });

  // B9:D-24: mobile partial check-in (bookings.partial-checkin.ts: gate
  // booking:checkin; then `canPartialCheckInOut` on the context's `access`).
  snapshot["B9:D-24:mobile-partial-checkin"] = perRoleSet((roles) => {
    const access = accessFor(roles);
    return Object.fromEntries(
      CUSTODIAN_CASES.flatMap((custodian) =>
        BOOKING_STATUSES.map((status) => [
          `custodian=${custodian}|${status}`,
          firstRefusal([
            ["denied:gate", () => !can(roles, E.booking, A.checkin)],
            [
              "denied:status",
              () =>
                !canPartialCheckInOut({
                  access,
                  booking: {
                    status,
                    custodianUserId:
                      custodian === "caller" ? "caller" : "someone-else",
                  },
                  userId: "caller",
                  direction: "checkin",
                }),
            ],
          ]),
        ])
      )
    );
  });

  // B9:D-20: booking assets column "can't manage items" on an open booking
  // (booking-assets-column.tsx): `!canManageBookingItems` on `useRoleAccess()`.
  snapshot["B9:D-20:web-assets-column"] = perRoleSet((roles) => {
    const access = accessFor(roles);
    return perCase(
      OPEN_STATUSES,
      (status) => !canManageBookingItems({ access, bookingStatus: status })
    );
  });

  // B9:D-15/D-21: booking asset row actions (list-asset-content.tsx, kit
  // membership aside): a caller who writes every booking sees them on every
  // row; otherwise only the custodian, within `mayRemoveBookingItems`.
  snapshot["B9:D-15/D-21:web-list-asset-actions"] = perRoleSet((roles) => {
    const access = accessFor(roles);
    const canUpdateBooking = can(roles, E.booking, A.update);
    return Object.fromEntries(
      CUSTODIAN_CASES.flatMap((custodian) =>
        BOOKING_STATUSES.map((status) => [
          `custodian=${custodian}|${status}`,
          access.bookings.writeAll
            ? true
            : custodian !== "caller"
            ? false
            : mayRemoveBookingItems({
                canUpdateBooking,
                access,
                bookingStatus: status,
              }),
        ])
      )
    );
  });

  // B9:D-21 (+B2): kit row "Remove" menu (kit-row.tsx): `mayRemoveBookingItems`
  // on the booking:update grant and `useRoleAccess()`.
  snapshot["B9:D-21:web-kit-row-remove"] = perRoleSet((roles) => {
    const access = accessFor(roles);
    const canUpdateBooking = can(roles, E.booking, A.update);
    return perCase(BOOKING_STATUSES, (status) =>
      mayRemoveBookingItems({ canUpdateBooking, access, bookingStatus: status })
    );
  });

  // ===================== Bookings: Task 4f =====================

  // B9:D-26: explicit check-out / check-in switch for every membership, read
  // through `isExplicitScanRequired` with the caller's access on every surface.
  // web: bookings.$bookingId.overview.tsx checkOut / checkOutRemaining
  // (assertQuickCheckoutAllowed) and checkIn; bookings.$bookingId.overview.fulfil-and-checkout.tsx.
  // mobile: bookings.checkout.ts, bookings.fulfil-and-checkout.ts,
  // bookings.checkin.ts, api+/mobile+/bookings.$bookingId.ts (canQuickCheckin /
  // canQuickCheckout). client: edit-booking-form.tsx (requireExplicitCheckout /
  // requireExplicitCheckin).
  snapshot["B9:D-26:explicit-scan"] = perRoleSet((roles) =>
    Object.fromEntries(
      [false, true].flatMap((admin) =>
        [false, true].map((selfService) => {
          const settings = {
            requireExplicitCheckoutForAdmin: admin,
            requireExplicitCheckoutForSelfService: selfService,
            requireExplicitCheckinForAdmin: admin,
            requireExplicitCheckinForSelfService: selfService,
          };
          const access = accessFor(roles);
          const checkout = isExplicitScanRequired({
            access,
            settings,
            direction: "checkout",
          });
          const checkin = isExplicitScanRequired({
            access,
            settings,
            direction: "checkin",
          });
          return [
            `admin=${admin}|selfService=${selfService}`,
            {
              webCheckout: checkout,
              webCheckin: checkin,
              mobileAndClientCheckout: checkout,
              mobileAndClientCheckin: checkin,
            },
          ];
        })
      )
    )
  );

  // B9:D-25: client time-limit bypass, `useRoleAccess().policy.bookings.bypassTimeLimits`:
  // edit-booking-form.tsx, new-booking-form.tsx,
  // components/assets/assets-index/create-booking-for-selected-assets-dialog.tsx,
  // bookings.$bookingId.overview.duplicate.tsx, extend-booking-dialog.tsx.
  snapshot["B9:D-25:web-client-time-bypass"] = perRoleSet(
    (roles) => accessFor(roles).policy.bookings.bypassTimeLimits
  );

  // B9:D-17: bookings index bulk menu (bookings._index.tsx):
  // `useRoleAccess().policy.bookings.showBulkActions`.
  snapshot["B9:D-17:web-bookings-bulk-menu"] = perRoleSet(
    (roles) => accessFor(roles).policy.bookings.showBulkActions
  );

  // B9:D-27: reservation presented as a request (`useReservationIsRequest`: a
  // loaded membership without `booking:checkout`): edit-booking-form.tsx
  // (process sidebar, button label), booking-status-badge.tsx (tooltip).
  snapshot["B9:D-27:web-reservation-request"] = perRoleSet((roles) => {
    const isRequest = roles.length > 0 && !can(roles, E.booking, A.checkout);
    return {
      processSidebar: isRequest,
      reserveButtonLabel: isRequest,
      statusBadgeTooltip: isRequest,
    };
  });

  // ===================== Bookings: Task 4g (menu half: 4f) =====================

  // B9:D-22: booking Delete menu item (actions-dropdown.tsx):
  // `!useRoleAccess().policy.bookings.deleteOnlyDrafts || isDraft`.
  snapshot["B9:D-22:web-delete-menu"] = perRoleSet((roles) => {
    const { deleteOnlyDrafts } = accessFor(roles).policy.bookings;
    return perCase(
      DRAFT_OR_NOT,
      (status) => !deleteOnlyDrafts || status === "DRAFT"
    );
  });

  // B9:D-17/D-22: bookings bulk delete: the menu renders only when
  // `policy.bookings.showBulkActions` (bookings._index.tsx), and its Delete is
  // disabled by `policy.bookings.deleteOnlyDrafts && !everyBookingInDraft`
  // (bulk-actions-dropdown.tsx).
  snapshot["B9:D-17/D-22:web-bulk-delete"] = perRoleSet((roles) => {
    const { showBulkActions, deleteOnlyDrafts } =
      accessFor(roles).policy.bookings;
    return perCase(SELECTION_CASES, (selection) => {
      if (!showBulkActions) return "no-menu";
      const everyBookingInDraft = selection === "allDraft";
      const deleteDisabled = deleteOnlyDrafts && !everyBookingInDraft;
      return deleteDisabled ? "disabled" : "enabled";
    });
  });

  // ===================== Custody & assets: Task 5c =====================

  // B9:D-29/D-30: mobile custody routes judge "self only" by the membership's
  // custody scope (`access.custody.assign`, effective role), after an
  // asset:custody (kit:custody) gate: custody.assign.ts, custody.release.ts,
  // custody.assign-quantity.ts (+ note wording, D-30), custody.release-quantity.ts,
  // bulk-assign-custody.ts, bulk-release-custody.ts, kits.bulk-actions.ts.
  snapshot["B9:D-29:mobile-custody"] = perRoleSet((roles) => {
    const selfOnly = accessFor(roles).custody.assign === "self";
    const scope = (entity: PermissionEntity) =>
      !can(roles, entity, A.custody)
        ? "denied:gate"
        : selfOnly
        ? "self"
        : "anyone";
    return {
      "custody.assign": scope(E.asset),
      "custody.release": scope(E.asset),
      "custody.assign-quantity": scope(E.asset),
      "custody.assign-quantity:note": scope(E.asset),
      "custody.release-quantity": scope(E.asset),
      "bulk-assign-custody": scope(E.asset),
      "bulk-release-custody": scope(E.asset),
      "kits.bulk-actions": scope(E.kit),
    };
  });

  // B9:D-33: mobile routes pass the effective role (`access.role`) to
  // getAssetIndexSettings: custody.assign.ts, bulk-assign-custody.ts,
  // bulk-release-custody.ts (asset:custody gate), bulk-update-location.ts
  // (asset:update gate).
  snapshot["B9:D-33:mobile-index-mode"] = perRoleSet((roles) => {
    const mode = (action: PermissionAction) =>
      can(roles, E.asset, action)
        ? getDefaultModeForRole(accessFor(roles).role)
        : "denied:gate";
    return {
      "custody.assign": mode(A.custody),
      "bulk-assign-custody": mode(A.custody),
      "bulk-release-custody": mode(A.custody),
      "bulk-update-location": mode(A.update),
    };
  });

  // B9:D-29/D-30: web custody UI "self only" / "Take" wording =
  // `useRoleAccess().custody.assign === "self"` (effective role):
  // components/assets/actions-dropdown.tsx; components/assets/bulk-actions-dropdown.tsx;
  // components/assets/bulk-assign-custody-dialog.tsx; components/kits/actions-dropdown.tsx;
  // components/kits/bulk-actions-dropdown.tsx; components/kits/bulk-assign-custody-dialog.tsx;
  // components/scanner/drawer/uses/assign-custody-drawer.tsx;
  // routes/_layout+/assets.$assetId.overview.assign-custody.tsx;
  // assets.$assetId.overview.release-custody.tsx; kits.$kitId.assets.assign-custody.tsx;
  // kits.$kitId.assets.release-custody.tsx; assets.$assetId.overview.tsx.
  snapshot["B9:D-29:web-client-self-only"] = perRoleSet(
    (roles) => accessFor(roles).custody.assign === "self"
  );

  // ===================== Assets: Task 5d =====================

  // B9:D-33: default index mode on the web (effective role) for every membership.
  snapshot["B9:D-33:web-server"] = perRoleSet((roles) =>
    getDefaultModeForRole(webRole(roles))
  );

  // B9:D-33: index mode seeded when an invite is accepted, from the invite's
  // effective role (modules/user/service.server.ts, `ensureAssetIndexModeForRole`
  // with `resolveRole(roles)`).
  snapshot["B9:D-33:invite-accept"] = perRoleSet((roles) =>
    getDefaultModeForRole(resolveRole(roles))
  );

  // B9:D-34: asset write affordances, each an `asset:update` matrix check:
  // codePreview (components/code-preview/code-preview.tsx, `userHasPermission`);
  // sequentialIdPrompt (routes/_layout+/_layout.tsx, `hasPermission`);
  // sequentialIdEndpoint (routes/api+/generate-sequential-ids.tsx, `hasPermission`);
  // scannerLocations (routes/_layout+/scanner.tsx, `hasPermission`).
  // The palette's Create asset/kit entries are in B9:D-38:palette.
  snapshot["B9:D-34:asset-write-affordances"] = perRoleSet((roles) => {
    const mayUpdateAssets = can(roles, E.asset, A.update);
    return {
      codePreview: mayUpdateAssets,
      sequentialIdPrompt: mayUpdateAssets,
      sequentialIdEndpoint: mayUpdateAssets,
      scannerLocations: mayUpdateAssets,
    };
  });

  // B9:D-35: asset index bulk menu (components/assets/assets-index/assets-list.tsx):
  // any of `asset:custody`, `asset:update`, `asset:delete`.
  snapshot["B9:D-35:assets-bulk-menu"] = perRoleSet((roles) =>
    can(roles, E.asset, [A.custody, A.update, A.delete])
  );

  // B9:D-36: kit index bulk menu (routes/_layout+/kits._index.tsx):
  // any of `kit:custody`, `kit:update`, `kit:delete`.
  snapshot["B9:D-36:kits-bulk-menu"] = perRoleSet((roles) =>
    can(roles, E.kit, [A.custody, A.update, A.delete])
  );

  // B9:D-37: "Set reminder" (components/assets/actions-dropdown.tsx):
  // `assetReminders:create`.
  snapshot["B9:D-37:set-reminder"] = perRoleSet((roles) =>
    can(roles, E.assetReminders, A.create)
  );

  // ===================== Audits: Tasks 6a, 6b =====================

  // B9:D-42: mobile audit scope from `access.audits.seeAll`: audits.ts gates
  // audit:read; audits.complete.ts and audits.record-scan.ts gate
  // audit:update.
  snapshot["B9:D-42:mobile-audits"] = perRoleSet((roles) => {
    const scope = accessFor(roles).audits.seeAll ? "all" : "assigned";
    const gatedOn = (action: PermissionAction) =>
      can(roles, E.audit, action) ? scope : "denied:gate";
    return {
      audits: gatedOn(A.read),
      "audits.complete": gatedOn(A.update),
      "audits.record-scan": gatedOn(A.update),
    };
  });

  // B9:D-43: web audit management. The detail loader opens an unassigned
  // audit on `access.audits.seeAll` and the overview lets a non-creator remove
  // assets on `access.policy.audits.manageOthers` (audits.$auditId.tsx,
  // audits.$auditId.overview.tsx); cancel reads `manageOthers` as well.
  snapshot["B9:D-43:web-audit-admin"] = perRoleSet((roles) => {
    const access = accessFor(roles);
    return {
      detailAndOverviewAllowList:
        access.audits.seeAll && access.policy.audits.manageOthers,
      effectiveRoleDenyList: access.policy.audits.manageOthers,
    };
  });

  // ===================== Admin areas: Tasks 7b, 7e =====================

  // B9:D-38: settings tabs for a team workspace, as the Settings layout loader
  // computes them (routes/_layout+/settings.tsx): each tab shows with the
  // matrix grant of the page it opens.
  snapshot["B9:D-38:settings-tabs"] = perRoleSet((roles) =>
    visibleSettingsTabs({ roles, isPersonalOrg: false }).map((t) => t.to)
  );

  // B9:D-38: sidebar (hooks/use-sidebar-nav-items.tsx:71; `hidden:
  // isBaseOrSelfService` at :126,145,152,159,189,196,202,208,230; Audits has no gate).
  snapshot["B9:D-38:sidebar"] = perRoleSet((roles) => {
    const shown = !hookFlags(roles).isBaseOrSelfService;
    return {
      home: shown,
      categories: shown,
      tags: shown,
      locations: shown,
      audits: true,
      reminders: shown,
      reports: shown,
      organization: shown,
      team: shown,
      workspaceSettings: shown,
    };
  });

  // B9:D-38/D-34: command-palette quick-nav (components/layout/command-palette/
  // command-palette.tsx:160-219 `isVisible`, context :510-532); inviteUser is
  // `roles.includes("ADMIN") || roles.includes("OWNER")` (:511-513). Role part
  // only: team also needs a non-personal workspace.
  snapshot["B9:D-38:palette"] = perRoleSet((roles) => {
    const shown = !hookFlags(roles).isBaseOrSelfService;
    return {
      audits: shown,
      team: shown,
      settings: shown,
      home: shown,
      createAsset: shown,
      createKit: shown,
      inviteUser: roles.includes(R.ADMIN) || roles.includes(R.OWNER),
    };
  });

  // B9:D-39: admin list bulk menus. `!isBaseOrSelfService`:
  // categories.tsx:152,171; tags.tsx:156,179; locations._index.tsx:101,129;
  // settings.custom-fields.index.tsx:129,154; settings.asset-models.index.tsx:98,121.
  // The NRM list (settings.team.nrm.tsx) shows its bulk menu with
  // `nonRegisteredMember:delete`, the only bulk action it offers.
  snapshot["B9:D-39:admin-bulk-menus"] = perRoleSet((roles) => {
    const shown = !hookFlags(roles).isBaseOrSelfService;
    return {
      categories: shown,
      tags: shown,
      locations: shown,
      customFields: shown,
      assetModels: shown,
      nonRegisteredMembers: can(roles, E.nonRegisteredMember, A.delete),
    };
  });

  // ===================== Membership: Tasks 8a-8f =====================

  // B9:D-01/D-10: how a membership is shown:
  // teamList modules/settings/service.server.ts:116-117 + settings.team.users.tsx:235;
  // inviteList modules/invite/service.server.ts:636-644 (BASE fallback) + settings.team.invites.tsx:226;
  // memberPage routes/_layout+/settings.team.users.$userId.tsx:151-154,172-174,180,199-201;
  // calendarFeedRole modules/calendar-subscription/service.server.ts:232.
  snapshot["B9:D-01:membership-display"] = perRoleSet((roles) => {
    const first = roles[0];
    const inviteRole = roles[0] ?? R.BASE;
    return {
      teamList: {
        roleEnum: first ?? null,
        label: roleLabel(first),
        rowActions: roleLabel(first) !== "Owner",
      },
      inviteList: {
        roleEnum: inviteRole,
        label: roleLabel(inviteRole),
        rowActions: roleLabel(inviteRole) !== "Owner",
      },
      memberPage: {
        roleEnum: first ?? null,
        label: roleLabel(first),
        showActions: roleLabel(first) !== "Owner",
      },
      calendarFeedRole: roles[0] ?? R.BASE,
    };
  });

  // B9:D-07: team member row menu, caller × target
  // (components/workspace/users-actions-dropdown.tsx:53,154,185): locked when
  // the caller holds ADMIN and the target's team-list roleEnum (roles[0]) is
  // ADMIN. The page needs teamMember:read (settings.team.users.tsx:48-54); the
  // row menu is hidden for an "Owner" label (settings.team.users.tsx:235).
  snapshot["B9:D-07:users-menu"] = perRoleSet((caller) => {
    const { isAdministrator } = hookFlags(caller);
    const reachesPage = can(caller, E.teamMember, A.read);
    return perRoleSet((target) => {
      const roleEnum = target[0];
      if (!reachesPage) return "no-page";
      if (roleLabel(roleEnum) === "Owner") return "no-menu";
      return isAdministrator && roleEnum === R.ADMIN ? "locked" : "open";
    });
  });

  // B9:D-07: server revoke (modules/user/utils.server.ts:135-154; caller role
  // is requirePermission's effective role), then revokeAccessToOrganization
  // refusing any OWNER-holding membership (modules/user/service.server.ts:1710-1742).
  snapshot["B9:D-07:revoke-guard"] = perRoleSet((target) =>
    perCase(CALLER_ROLES, (caller) =>
      (target.includes(R.ADMIN) && caller !== R.OWNER) ||
      target.includes(R.OWNER)
        ? "refused"
        : "allowed"
    )
  );

  // B9:D-07: changeUserRole guards on the member's roles[0]
  // (modules/user/service.server.ts:1849-1930), changing them to BASE.
  snapshot["B9:D-07:change-role-guard"] = perRoleSet((target) =>
    perCase(CALLER_ROLES, (caller) => {
      const currentRole = target[0];
      const refused =
        currentRole === R.OWNER ||
        (currentRole === R.ADMIN && caller !== R.OWNER);
      return refused ? "refused" : "allowed";
    })
  );

  // B9:D-02/D-03: does a manual role change transfer the member's entities?
  // server modules/user/utils.server.ts:385-388 `isDemotion(roles[0], newRole)`;
  // dialog components/workspace/change-role-dialog.tsx:148-151, whose
  // currentRoleEnum is the team list's roles[0].
  snapshot["B9:D-02/D-03:role-change-transfers"] = perRoleSet((roles) =>
    perCase([R.ADMIN, R.SELF_SERVICE, R.BASE] as const, (to) => {
      const transfers = isDemotion(roles[0] as OrganizationRoles, to);
      return { server: transfers, dialog: transfers };
    })
  );

  // B9:D-05 (+F6, F12): SSO group-claim transition, `reconcileSsoGroupMembership`
  // (modules/user/service.server.ts:577-686; the function the plan's brief
  // called `handleSCIMTransition` was renamed before this task ran). A
  // membership with no mapped group keeps the row when it holds OWNER
  // (:601-616, `keepOwnerAccess`, which reports `newRole: currentRoles[0]`) and
  // otherwise deletes it via `revokeAccessToOrganization` (:619, :1710-1835),
  // which independently refuses to remove an OWNER-holding row (:1731-1742).
  // Any mapped group overwrites `roles` with `userOrganization.update`
  // (:643-657) and transfers nothing.
  snapshot["B9:D-05:sso-transition"] = perRoleSet((current) =>
    perCase(["ADMIN", "SELF_SERVICE", "BASE", "none"] as const, (desired) => {
      if (desired === "none") {
        return current.includes(R.OWNER)
          ? {
              rolesAfter: current,
              newRole: current[0] ?? null,
              transfers: NO_TRANSFER,
            }
          : { rolesAfter: null, newRole: null, transfers: NO_TRANSFER };
      }
      return {
        rolesAfter: [desired],
        newRole: desired,
        transfers: NO_TRANSFER,
      };
    })
  );

  // B9:F4: announcement audience role: layout badge
  // routes/_layout+/_layout.tsx:221-226 (`roles[0]`; no role → count 0), updates
  // page routes/_layout+/updates.tsx and routes/api+/updates.tsx
  // (requirePermission's effective role).
  snapshot["B9:F4:announcements"] = perRoleSet((roles) => ({
    layoutBadgeRole: roles[0] ?? null,
    updatesPageRole: webRole(roles),
  }));

  // B9:D-06/D-08/D-09: "held anywhere" membership reads: owner
  // (utils/roles.server.ts:299-314), new-owner eligibility
  // (modules/organization/service.server.ts:958), transfer recipients
  // (routes/api+/user.transfer-recipients.ts:34-40, hasSome OWNER/ADMIN).
  snapshot["B9:D-06/D-08/D-09:owner-and-recipients"] = perRoleSet((roles) => ({
    ownsWorkspace: isOrganizationOwner({
      userOrganizations: [{ organization: { id: "org" }, roles }],
      organizationId: "org",
    }),
    eligibleAsNewOwner: roles.includes(R.ADMIN),
    receivesTransfers: holdsAny(roles, [R.OWNER, R.ADMIN]),
  }));

  // ===================== Notifications: Task 9 =====================

  // B9:D-45/D-48/D-49: Prisma audience filters, `roles: { hasSome: … }`:
  // orgBookingBroadcasts modules/organization/service.server.ts:567
  // (getOrganizationAdminsEmails) + lowStock :618 (getOrganizationAdminsForNotification);
  // bookingNotifyPicker modules/team-member/service.server.ts:1241;
  // reminderPicker routes/api+/reminders.team-members.ts:55;
  // modelFiltersRecipients routes/api+/model-filters.ts:222.
  snapshot["B9:D-45/D-48/D-49:audiences"] = perRoleSet((roles) => ({
    orgBookingBroadcasts: holdsAny(roles, [R.OWNER, R.ADMIN]),
    lowStock: holdsAny(roles, [R.OWNER, R.ADMIN]),
    bookingNotifyPicker: holdsAny(roles, [R.ADMIN, R.OWNER]),
    reminderPicker: holdsAny(roles, [R.ADMIN, R.OWNER]),
    modelFiltersRecipients: holdsAny(roles, [R.ADMIN, R.OWNER]),
  }));

  // B9:D-47: manage a booking's recipients:
  // actionsDropdown `!isBaseOrSelfService` (components/booking/actions-dropdown.tsx:56,158);
  // recipientsField `isAdministratorOrOwner` (new-booking-form.tsx:202,
  // components/assets/assets-index/create-booking-for-selected-assets-dialog.tsx:180);
  // server loader/action and bookings.new action on requirePermission's
  // isSelfServiceOrBase (overview.tsx:181,2104; bookings.new.tsx:340).
  snapshot["B9:D-47:manage-recipients"] = perRoleSet((roles) => {
    const flags = hookFlags(roles);
    const server = !isSelfServiceOrBaseRole(webRole(roles));
    return {
      actionsDropdown: !flags.isBaseOrSelfService,
      recipientsField: flags.isAdministratorOrOwner,
      overviewLoaderAndAction: server,
      bookingsNewAction: server,
    };
  });

  // ===================== Companion: Task 10 (B8) =====================
  // Reproduced here because the webapp cannot import the companion. Task 10
  // rewrites them onto the same resolver its lib/role-access.ts uses.

  // B8:D-20/D-21: booking detail item actions (apps/companion/app/(tabs)/bookings/[id].tsx):
  // isRestrictedRole = SELF_SERVICE or BASE held anywhere (:147-149);
  // add = manage models / scan / browse (:1426,1777,1805);
  // remove = select to remove (:1835); fulfilCta (:1981).
  snapshot["B8:D-20/D-21:companion-booking-items"] = perRoleSet((roles) => {
    const isRestrictedRole = roles.some(
      (r) => r === R.SELF_SERVICE || r === R.BASE
    );
    return perCase(BOOKING_STATUSES, (status) => {
      const editable =
        !CLOSED_STATUSES.includes(status) &&
        (!isRestrictedRole || status === "DRAFT");
      return {
        add: editable,
        remove: editable,
        fulfilCta: !isRestrictedRole && status === "RESERVED",
      };
    });
  });

  // B8:D-15: companion "writes only own bookings" (bookings/[id].tsx:1398-1399).
  snapshot["B8:D-15:companion-own-writes"] = perRoleSet(
    (roles) =>
      roles.some((r) => r === R.SELF_SERVICE || r === R.BASE) &&
      !roles.some((r) => r === R.OWNER || r === R.ADMIN)
  );

  // B8:D-29: companion custody "take for yourself only": SELF_SERVICE held
  // anywhere (app/(tabs)/scanner.tsx:231; app/(tabs)/assets/[id].tsx:87).
  snapshot["B8:D-29:companion-self-custody"] = perRoleSet((roles) =>
    roles.includes(R.SELF_SERVICE)
  );

  // B8:D-42: companion "All audits" toggle (lib/permissions.ts:37-39,
  // userCanSeeOrgWideAudits): OWNER or ADMIN held anywhere.
  snapshot["B8:D-42:companion-audit-scope"] = perRoleSet(
    (roles) =>
      roles.length > 0 && roles.some((r) => r === R.OWNER || r === R.ADMIN)
  );

  // ===================== Custody and asset list =====================

  // D-28:client: the CLIENT's custody visibility (custody filters,
  // availability columns, custody chips), every role set x toggles. Reads
  // `userHasCustodyViewPermission`
  // (custody-and-bookings-permissions.validator.client.ts): the effective
  // role's `access.custody.seeAll`, and nothing for a membership with no known
  // role.
  snapshot["D-28:client"] = Object.fromEntries(
    ROLE_SETS.map((roles) => [
      key(roles),
      Object.fromEntries(
        TOGGLE_COMBOS.map((t) => [
          toggleKey(t),
          userHasCustodyViewPermission({
            roles: roles as OrganizationRoles[],
            organization: t,
          }),
        ])
      ),
    ])
  );

  // D-29:assign: the WEB custody-assignment scope, every role set. Services,
  // routes and the assignment picker all pass the caller's access to
  // `resolveCustodianPickerScope` (modules/team-member/service.server.ts).
  snapshot["D-29:assign"] = Object.fromEntries(
    ROLE_SETS.map((roles) => [
      key(roles),
      resolveCustodianPickerScope({
        purpose: "custody-assignment",
        access: accessFor(roles),
        userId: "caller",
      }).mode,
    ])
  );

  // D-31: the web asset index lists only bookable assets. Both index loaders
  // (modules/asset/data.server.ts, simple and advanced) read the caller's
  // `access.policy.assets.listScope`.
  snapshot["D-31"] = Object.fromEntries(
    ROLE_SETS.map((roles) => [
      key(roles),
      accessFor(roles).policy.assets.listScope,
    ])
  );

  // D-32: the advanced asset index is available. The index loader refuses
  // ADVANCED mode when `access.policy.ui.advancedAssetIndex` is off
  // (routes/_layout+/assets._index.tsx).
  snapshot["D-32"] = Object.fromEntries(
    ROLE_SETS.map((roles) => [
      key(roles),
      accessFor(roles).policy.ui.advancedAssetIndex,
    ])
  );

  return snapshot;
}
