# User-Level Date/Time Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-locale date path with an app-wide, user-level date/time formatting layer (date format, time format, week start, timezone) that every UI, export, PDF, email, and input surface resolves through, so all surfaces agree.

**Architecture:** A single pure `formatDate(value, prefs, opts)` decouples date ORDER from locale by reassembling `Intl.formatToParts` output (timezone conversion stays in Intl; presentation is deterministic). Preferences live on the `User` row (nullable, detected from browser hints at creation, lazily backfilled for existing users). They are resolved once in the root loader into `requestInfo.formatPrefs` (client) and via `resolveUserFormatPrefsById` (server: acting user for exports/PDFs, recipient user for emails). This supersedes PR #2654's org-level, `DateS`-only, locale-swap approach.

**Tech Stack:** Remix (React Router) + TypeScript, Prisma/PostgreSQL, Vitest, Radix UI + Tailwind, `react-day-picker@9.14.0`, `date-fns`, Zod + `react-zorm`.

## Global Constraints

- **Package manager / tests:** pnpm monorepo. Unit tests: `pnpm webapp:test -- --run <path>` (ALWAYS `--run`). Typecheck: `pnpm --filter @shelf/webapp typecheck`. Full gate: `pnpm webapp:validate`. Never run parallel test processes.
- **Migrations:** NEVER run `db:prepare-migration` or `db:deploy-migration`. Author migration SQL by hand under `packages/database/prisma/migrations/`. Only `pnpm db:generate` to regenerate the client.
- **Commits:** Conventional Commits. Commit body lines ≤ 100 chars. NO `Co-Authored-By` / `🤖 Generated with` trailers. Never `git add`/commit unless the human explicitly asks; the plan shows the commit command but the human authorizes running it. Never `git push`.
- **Buttons:** every native `<button>` needs an explicit `type` (`local-rules/require-button-type`). Link buttons (`to=`) don't.
- **Disabled submits:** use `useDisabled` (from `~/hooks/use-disabled`), never `useNavigation` directly.
- **Forms:** display server-side validation errors as a fallback via `getValidationErrors<typeof Schema>(actionData?.error)` in every input.
- **Date display:** always use `DateS` / `useDateFormatter()` — never raw `toLocaleDateString`/`toLocaleString`.
- **Docs:** JSDoc on every new file and exported function/component/type.
- **Org-scoped IDs:** any user-supplied entity ID must be proven to belong to the caller's org before use (`~/utils/org-validation.server`). (Applies if any task touches org-scoped reads.)
- **react-doctor:** keep changed files clean (CI fails on new errors). No new `autoFocus` (use `useAutoFocus`); no `dangerouslySetInnerHTML` for scripts without a `// why:`.

This section's constraints apply to EVERY task below.

---

## Interfaces Contract (frozen — every task uses these exact names/types)

_The following signatures are the load-bearing contract shared across all phases. Do not rename fields, functions, or enum members. Each phase's tasks were authored against this._

These signatures are frozen. Do not rename fields, functions, or enum members.
Every phase consumes/produces exactly these.

### Prisma enums + User fields (Phase 1)

```prisma
enum DateFormatPreference { DD_MM_YYYY MM_DD_YYYY YYYY_MM_DD }
enum TimeFormatPreference { H12 H24 }
enum WeekStartPreference  { MONDAY SUNDAY SATURDAY }

model User {
  // ...
  dateFormat DateFormatPreference? // null → not yet detected
  timeFormat TimeFormatPreference? // null → not yet detected
  weekStart  WeekStartPreference?  // null → not yet detected
  timeZone   String?               // IANA name; null → not yet detected
}
```

`Organization.dateFormat` and `enum DateFormat` (from PR #2654) are REMOVED.

### Formatter module — `app/utils/date-format.ts` (Phase 2, full rewrite)

```ts
import type {
  DateFormatPreference,
  TimeFormatPreference,
  WeekStartPreference,
} from "@prisma/client";
import type { ClientHint } from "~/utils/client-hints"; // { locale: string; timeZone: string }

/** Raw, possibly-unset user prefs (mirrors the nullable DB columns). */
export type RawFormatPrefs = {
  dateFormat: DateFormatPreference | null;
  timeFormat: TimeFormatPreference | null;
  weekStart: WeekStartPreference | null;
  timeZone: string | null;
};

/** Fully-resolved concrete prefs the formatter consumes. */
export type ResolvedFormatPrefs = {
  dateFormat: DateFormatPreference; // "DD_MM_YYYY" | "MM_DD_YYYY" | "YYYY_MM_DD"
  timeFormat: TimeFormatPreference; // "H12" | "H24"
  weekStartsOn: 0 | 1 | 6; // Sun=0, Mon=1, Sat=6 (react-day-picker convention)
  timeZone: string; // IANA, always concrete
};

/** Concrete prefs detected from browser hints, ready to STORE on a User row. */
export type DetectedFormatPrefs = {
  dateFormat: DateFormatPreference;
  timeFormat: TimeFormatPreference;
  weekStart: WeekStartPreference;
  timeZone: string;
};

export const HARDCODED_DEFAULT_PREFS: ResolvedFormatPrefs = {
  dateFormat: "MM_DD_YYYY",
  timeFormat: "H12",
  weekStartsOn: 0,
  timeZone: "UTC",
};

/** Superset of the option shapes DateS callers pass today (facts-02 §C). */
export type DateFormatOptions = {
  weekday?: "long" | "short" | "narrow";
  year?: "numeric" | "2-digit";
  month?: "numeric" | "2-digit" | "short" | "long";
  day?: "numeric" | "2-digit";
  hour?: "numeric" | "2-digit";
  minute?: "numeric" | "2-digit";
  dateStyle?: "short" | "medium" | "long";
  timeStyle?: "short" | "long";
  includeTime?: boolean;
  onlyTime?: boolean;
  /** Absolute date, no timezone conversion (working-hours overrides). */
  localeOnly?: boolean;
};

/** Map a locale's short-date part order to our enum. */
export function detectDateFormat(locale: string): DateFormatPreference;
/** hour12 → H12/H24. */
export function detectTimeFormat(locale: string): TimeFormatPreference;
/** weekInfo.firstDay (ISO 1..7) → enum, with region fallback. */
export function detectWeekStart(locale: string): WeekStartPreference;

/** Detect all four concrete prefs from hints (creation + lazy backfill). */
export function detectFormatPrefsFromHints(
  hints: ClientHint
): DetectedFormatPrefs;

/**
 * Resolve raw prefs (any field may be null) against optional hints into concrete
 * prefs. Per field: stored value → detect-from-hints → HARDCODED_DEFAULT_PREFS.
 * `weekStart` enum maps to `weekStartsOn`: MONDAY→1, SUNDAY→0, SATURDAY→6.
 */
export function resolveFormatPrefs(
  userPrefs: RawFormatPrefs | null,
  hints: ClientHint | null
): ResolvedFormatPrefs;

/**
 * The pure formatter — identical output on client and server. Converts the UTC
 * instant to prefs.timeZone via Intl.formatToParts(en-US), then REASSEMBLES the
 * parts in prefs.dateFormat order with prefs.timeFormat (hour12). No locale
 * leakage. `localeOnly` skips tz conversion (uses the wall-clock date as-is).
 */
export function formatDate(
  value: string | Date,
  prefs: ResolvedFormatPrefs,
  opts?: DateFormatOptions
): string;
```

### Server resolution seam — `app/utils/date-format.server.ts` (Phase 2/3)

```ts
/** Fetch a user's raw prefs + resolve. `hints` optional (loaders have it). */
export function resolveUserFormatPrefsById(
  userId: string,
  hints: ClientHint | null,
  tx?: PrismaTxClient
): Promise<ResolvedFormatPrefs>;
```

### Client hooks (Phase 3)

```ts
// app/hooks/use-format-prefs.ts
export function useFormatPrefs(): ResolvedFormatPrefs; // reads useRequestInfo().formatPrefs

// app/hooks/use-date-formatter.ts
export function useDateFormatter(): {
  prefs: ResolvedFormatPrefs;
  formatDate: (value: string | Date, opts?: DateFormatOptions) => string;
  formatTime: (value: string | Date, opts?: DateFormatOptions) => string;
  formatDateTime: (value: string | Date, opts?: DateFormatOptions) => string;
};
```

### Root loader (Phase 3)

`app/root.tsx` loader adds `requestInfo.formatPrefs: ResolvedFormatPrefs`,
resolved from `context.getSession()?.userId` (session-optional; no session →
`resolveFormatPrefs(null, getClientHint(request))`). Fires the lazy backfill.

### Lazy backfill (Phase 3) — `app/modules/user/format-prefs.server.ts`

```ts
/** Fire-and-forget, null-guarded updateMany (mirrors recordMobileActivity). */
export function detectAndPersistFormatPrefs(
  userId: string,
  currentPrefs: RawFormatPrefs,
  hints: ClientHint
): void;
```

### User creation threading (Phase 4)

`createUser` payload gains optional `formatPrefs?: DetectedFormatPrefs` spread
into `tx.user.create({ data })`. Each entry action computes
`detectFormatPrefsFromHints(getClientHint(request))` and threads it down.

### User update (Phase 5)

`UpdateUserPayload` (`app/modules/user/types.ts`) gains:
`dateFormat?`, `timeFormat?`, `weekStart?`, `timeZone?` (typed `User["dateFormat"]` etc.).
`getUserWithContact` select + `updateUser` add the 4 fields.

### DateS (Phase 3, rewrite) — public API UNCHANGED

`<DateS date options includeTime onlyTime localeOnly />` — same 5 props. Internals
switch to `useDateFormatter()` + `formatDate`.

### Shared picker (Phase 8) — `app/components/shared/date-time-picker.tsx`

```tsx
export type DateTimePickerProps = {
  name: string;
  mode?: "date" | "datetime"; // default "date"
  value?: string; // controlled wire string
  defaultValue?: string; // uncontrolled
  onChange?: (wire: string) => void;
  min?: Date;
  max?: Date;
  label?: string;
  hideLabel?: boolean;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  placeholder?: string;
  clearable?: boolean;
};
```

Emits the SAME wire strings the servers already parse: `YYYY-MM-DD` (date),
`YYYY-MM-DDTHH:mm` (datetime, = `DATE_TIME_FORMAT` at `app/utils/constants.ts:20`).
Integrates via a hidden `<input name={name}>` mirroring picker state. Renders per
`useDateFormatter()` prefs: order for the calendar caption, `weekStartsOn` for
react-day-picker, `timeFormat` for the time control.

### Settings selectors (Phase 5) — `app/components/user/language-region/`

`DateFormatSelect`, `TimeFormatSelect`, `WeekStartSelect` (small-enum Popover, base
= old `date-format-selector.tsx` pattern), `TimezoneSelect` (searchable Popover,
base = `field-selector.tsx`, options from `Intl.supportedValuesOf("timeZone")` with
try/catch fallback). Rendered in `<LanguageRegionForm user={user} />` Card in
`account-details.general.tsx`. New action intent `updateFormatPrefs`.

---

## Phase 0: Retire the org-level `dateFormat` added by PR #2654

This phase reverts every reference to the workspace-scoped `Organization.dateFormat`
and `enum DateFormat` that PR #2654 introduced, clearing the field so Phase 1 can
introduce the new **user-level** preferences (`DateFormatPreference` /
`TimeFormatPreference` / `WeekStartPreference` / `timeZone`). Because #2654 is
unmerged, production never saw `Organization.dateFormat`, so **no down-migration is
authored** — the superseded migration directory is deleted and Phase 1 writes a
fresh one. Every task is ordered so that `pnpm --filter @shelf/webapp typecheck`
stays green at each commit boundary: all code references are stripped **before** the
Prisma schema field/enum is removed. The interim runtime behavior returned to is the
pre-#2654 `AUTO` behavior (dates formatted from the browser locale everywhere);
Phase 3 rewires `DateS` to the new user prefs. `app/utils/date-format.ts` and its
test are **left intact** here (given a one-line, prisma-decoupling tweak) — Phase 2
overwrites that file entirely.

### Task 0.1: Strip `dateFormat` from the two workspace-edit routes

**Files:** (Modify: `apps/webapp/app/routes/_layout+/settings.general.tsx:242,298,466` / Modify: `apps/webapp/app/routes/_layout+/account-details.workspace.$workspaceId.edit.tsx:278,327,470`)
**Interfaces:** (Consumes: nothing new / Produces: routes no longer read `organization.dateFormat` nor pass `dateFormat` into `updateOrganization` or `WorkspaceEditForms`)

Done first so that when the Zod schema field is removed in Task 0.2 and the service
param in Task 0.3, no route still destructures a now-missing property. Removing the
`dateFormat={organization.dateFormat}` prop is safe while `Props.dateFormat` is still
optional (omitting an optional prop typechecks).

- [ ] **Step 1: Remove the `dateFormat` destructure in `settings.general.tsx` (action).** Current code at `settings.general.tsx:237-244`:

  ```ts
  const {
    name,
    currency,
    id,
    qrIdDisplayPreference,
    dateFormat,
    showShelfBranding,
  } = payload;
  ```

  Change to (drop the `dateFormat,` line):

  ```ts
  const { name, currency, id, qrIdDisplayPreference, showShelfBranding } =
    payload;
  ```

- [ ] **Step 2: Remove the `dateFormat` argument from the `updateOrganization` call in `settings.general.tsx`.** Current code at `settings.general.tsx:291-300`:

  ```ts
  await updateOrganization({
    id,
    name,
    image: file || null,
    userId: authSession.userId,
    currency,
    qrIdDisplayPreference,
    dateFormat,
    showShelfBranding: nextShowShelfBranding,
  });
  ```

  Change to (drop `dateFormat,`):

  ```ts
  await updateOrganization({
    id,
    name,
    image: file || null,
    userId: authSession.userId,
    currency,
    qrIdDisplayPreference,
    showShelfBranding: nextShowShelfBranding,
  });
  ```

- [ ] **Step 3: Remove the `dateFormat` prop passed to `WorkspaceEditForms` in `settings.general.tsx`.** Current code at `settings.general.tsx:462-467`:

  ```tsx
  <WorkspaceEditForms
    name={organization.name}
    currency={organization.currency}
    qrIdDisplayPreference={organization.qrIdDisplayPreference}
    dateFormat={organization.dateFormat}
  />
  ```

  Change to (drop the `dateFormat` line):

  ```tsx
  <WorkspaceEditForms
    name={organization.name}
    currency={organization.currency}
    qrIdDisplayPreference={organization.qrIdDisplayPreference}
  />
  ```

- [ ] **Step 4: Remove the `dateFormat` destructure in `account-details.workspace.$workspaceId.edit.tsx` (action).** Current code at `account-details.workspace.$workspaceId.edit.tsx:274-280`:

  ```ts
  const {
    name,
    currency,
    qrIdDisplayPreference,
    dateFormat,
    showShelfBranding,
  } = parsedData;
  ```

  Change to (drop the `dateFormat,` line):

  ```ts
  const { name, currency, qrIdDisplayPreference, showShelfBranding } =
    parsedData;
  ```

- [ ] **Step 5: Remove the `dateFormat` argument from the `updateOrganization` call in `account-details.workspace.$workspaceId.edit.tsx`.** Current code at `account-details.workspace.$workspaceId.edit.tsx:320-329`:

  ```ts
  await updateOrganization({
    id,
    name,
    image: file || null,
    userId: authSession.userId,
    currency,
    qrIdDisplayPreference,
    dateFormat,
    showShelfBranding: nextShowShelfBranding,
  });
  ```

  Change to (drop `dateFormat,`):

  ```ts
  await updateOrganization({
    id,
    name,
    image: file || null,
    userId: authSession.userId,
    currency,
    qrIdDisplayPreference,
    showShelfBranding: nextShowShelfBranding,
  });
  ```

- [ ] **Step 6: Remove the `dateFormat` prop passed to `WorkspaceEditForms` in `account-details.workspace.$workspaceId.edit.tsx`.** Current code at `account-details.workspace.$workspaceId.edit.tsx:466-472`:

  ```tsx
  <WorkspaceEditForms
    name={organization.name || name}
    currency={organization.currency}
    qrIdDisplayPreference={organization.qrIdDisplayPreference}
    dateFormat={organization.dateFormat}
    className="mt-4"
  />
  ```

  Change to (drop the `dateFormat` line):

  ```tsx
  <WorkspaceEditForms
    name={organization.name || name}
    currency={organization.currency}
    qrIdDisplayPreference={organization.qrIdDisplayPreference}
    className="mt-4"
  />
  ```

- [ ] **Step 7: Typecheck.** Run:

  ```bash
  pnpm --filter @shelf/webapp typecheck
  ```

  Expected: PASS. `Props.dateFormat`, the Zod schema field, and the service param
  still exist (optional), so omitting them from the call sites typechecks.

- [ ] **Step 8: Commit.**

  ```bash
  git commit -am "refactor(workspace): stop wiring org dateFormat through edit routes
  ```

Drop the dateFormat destructure, updateOrganization argument, and
WorkspaceEditForms prop from the settings.general and account-details
workspace edit routes. First step of retiring the unmerged PR #2654
org-level date format; the schema field and service param are removed
in later Phase 0 tasks."

````

### Task 0.2: Remove the date-format control from the workspace edit form and delete its selector

**Files:** (Modify: `apps/webapp/app/components/workspace/edit-form.tsx:4,24,39,54,68,76,87,203-207` / Delete: `apps/webapp/app/components/workspace/date-format-selector.tsx`)
**Interfaces:** (Consumes: nothing / Produces: `Props`/`EditGeneralWorkspaceSettingsFormSchema` no longer carry `dateFormat`; `DateFormatSelector` is gone)

`date-format-selector.tsx` is imported only by `edit-form.tsx` (verified via
`git grep -n DateFormatSelector`), so removing the import and deleting the file are
safe together. Removing `dateFormat: z.custom<DateFormat>()` from the schema is what
makes the route destructures removed in Task 0.1 correct.

- [ ] **Step 1: Remove the `DateFormat` type import in `edit-form.tsx`.** Current code at `edit-form.tsx:1-7`:

```ts
import {
  type Organization,
  type Currency,
  type DateFormat,
  OrganizationType,
  type QrIdDisplayPreference,
} from "@prisma/client";
````

Change to (drop `type DateFormat,`):

```ts
import {
  type Organization,
  type Currency,
  OrganizationType,
  type QrIdDisplayPreference,
} from "@prisma/client";
```

- [ ] **Step 2: Remove the `DateFormatSelector` import in `edit-form.tsx`.** Delete this line at `edit-form.tsx:24`:

  ```ts
  import DateFormatSelector from "./date-format-selector";
  ```

- [ ] **Step 3: Remove the `dateFormat` field from `Props` in `edit-form.tsx`.** Current code at `edit-form.tsx:35-41`:

  ```ts
  interface Props {
    name?: Organization["name"];
    currency?: Organization["currency"];
    qrIdDisplayPreference?: Organization["qrIdDisplayPreference"];
    dateFormat?: Organization["dateFormat"];
    className?: string;
  }
  ```

  Change to (drop the `dateFormat?` line):

  ```ts
  interface Props {
    name?: Organization["name"];
    currency?: Organization["currency"];
    qrIdDisplayPreference?: Organization["qrIdDisplayPreference"];
    className?: string;
  }
  ```

- [ ] **Step 4: Remove the `dateFormat` field from the Zod schema in `edit-form.tsx`.** Delete this line at `edit-form.tsx:54`:

  ```ts
  dateFormat: z.custom<DateFormat>(),
  ```

- [ ] **Step 5: Remove `dateFormat` from the `WorkspaceEditForms` destructure and passthrough in `edit-form.tsx`.** Current code at `edit-form.tsx:64-81`:

  ```tsx
  export const WorkspaceEditForms = ({
    name,
    currency,
    qrIdDisplayPreference,
    dateFormat,
    className,
  }: Props) => (
    <div className={tw("flex flex-col gap-3", className)}>
      <WorkspaceGeneralEditForms
        name={name}
        currency={currency}
        qrIdDisplayPreference={qrIdDisplayPreference}
        dateFormat={dateFormat}
      />
      <WorkspacePermissionsEditForm />
      <WorkspaceSSOEditForm />
    </div>
  );
  ```

  Change to (drop the `dateFormat,` destructure and the `dateFormat={dateFormat}` passthrough):

  ```tsx
  export const WorkspaceEditForms = ({
    name,
    currency,
    qrIdDisplayPreference,
    className,
  }: Props) => (
    <div className={tw("flex flex-col gap-3", className)}>
      <WorkspaceGeneralEditForms
        name={name}
        currency={currency}
        qrIdDisplayPreference={qrIdDisplayPreference}
      />
      <WorkspacePermissionsEditForm />
      <WorkspaceSSOEditForm />
    </div>
  );
  ```

- [ ] **Step 6: Remove `dateFormat` from the `WorkspaceGeneralEditForms` destructure in `edit-form.tsx`.** Current code at `edit-form.tsx:83-89`:

  ```tsx
  const WorkspaceGeneralEditForms = ({
    name,
    currency,
    qrIdDisplayPreference,
    dateFormat,
    className,
  }: Props) => {
  ```

  Change to (drop the `dateFormat,` line):

  ```tsx
  const WorkspaceGeneralEditForms = ({
    name,
    currency,
    qrIdDisplayPreference,
    className,
  }: Props) => {
  ```

- [ ] **Step 7: Remove the "Date format" `FormRow` block in `edit-form.tsx`.** Delete this entire block at `edit-form.tsx:196-208`:

  ```tsx
  <div>
    <FormRow
      rowLabel={"Date format"}
      className={"border-b-0"}
      subHeading="How dates are displayed across the workspace (lists, detail pages, reports). Automatic follows each user's browser language."
    >
      <InnerLabel hideLg>Date format</InnerLabel>
      <DateFormatSelector
        defaultValue={dateFormat || "AUTO"}
        name={zo.fields.dateFormat()}
      />
    </FormRow>
  </div>
  ```

  (The adjacent Currency `FormRow` above and the "Preferred display code" `FormRow`
  below are unchanged.)

- [ ] **Step 8: Delete the selector component file.**

  ```bash
  git rm apps/webapp/app/components/workspace/date-format-selector.tsx
  ```

- [ ] **Step 9: Confirm nothing else imports the selector.** Run:

  ```bash
  git grep -n "date-format-selector\|DateFormatSelector" -- apps/webapp
  ```

  Expected: no matches.

- [ ] **Step 10: Typecheck.** Run:

  ```bash
  pnpm --filter @shelf/webapp typecheck
  ```

  Expected: PASS. `enum DateFormat` still exists in the schema, so
  `date-format.ts`/`date.tsx` (which still import/use it) continue to compile.

- [ ] **Step 11: Commit.**

  ```bash
  git commit -am "refactor(workspace): remove date-format control from workspace edit form
  ```

Drop the dateFormat prop, Zod field, and DateFormat import from the
workspace edit form and delete the workspace DateFormatSelector. The
date-format preference is moving from workspace to user scope."

````

### Task 0.3: Remove `dateFormat` from `updateOrganization` and `ORGANIZATION_SELECT_FIELDS`

**Files:** (Modify: `apps/webapp/app/modules/organization/service.server.ts:266,281,290,429`)
**Interfaces:** (Consumes: nothing / Produces: `updateOrganization` no longer accepts `dateFormat`; `OrganizationFromUser` no longer carries `dateFormat`)

All callers dropped `dateFormat` in Task 0.1, so removing the param, its type, its
data spread, and the select field compiles cleanly. This must precede the schema
removal (Task 0.5) because `dateFormat: true` on line 429 references the still-present
Prisma field.

- [ ] **Step 1: Remove the `dateFormat` destructured param + its type in `updateOrganization`.** Current code at `service.server.ts:257-284`:

```ts
export async function updateOrganization({
  id,
  name,
  image,
  userId,
  currency,
  ssoDetails,
  hasSequentialIdsMigrated,
  qrIdDisplayPreference,
  dateFormat,
  showShelfBranding,
  customEmailFooter,
}: Pick<Organization, "id"> & {
  currency?: Organization["currency"];
  name?: string;
  userId: User["id"];
  image?: File | null;
  ssoDetails?: {
    selfServiceGroupId: string | null;
    adminGroupId: string | null;
    baseUserGroupId: string | null;
  };
  hasSequentialIdsMigrated?: Organization["hasSequentialIdsMigrated"];
  qrIdDisplayPreference?: Organization["qrIdDisplayPreference"];
  dateFormat?: Organization["dateFormat"];
  showShelfBranding?: Organization["showShelfBranding"];
  customEmailFooter?: string | null;
}) {
````

Change to (drop the `dateFormat,` destructure line and the `dateFormat?:` type line):

```ts
export async function updateOrganization({
  id,
  name,
  image,
  userId,
  currency,
  ssoDetails,
  hasSequentialIdsMigrated,
  qrIdDisplayPreference,
  showShelfBranding,
  customEmailFooter,
}: Pick<Organization, "id"> & {
  currency?: Organization["currency"];
  name?: string;
  userId: User["id"];
  image?: File | null;
  ssoDetails?: {
    selfServiceGroupId: string | null;
    adminGroupId: string | null;
    baseUserGroupId: string | null;
  };
  hasSequentialIdsMigrated?: Organization["hasSequentialIdsMigrated"];
  qrIdDisplayPreference?: Organization["qrIdDisplayPreference"];
  showShelfBranding?: Organization["showShelfBranding"];
  customEmailFooter?: string | null;
}) {
```

- [ ] **Step 2: Remove the `dateFormat` spread from the `data` object.** Delete this line at `service.server.ts:290`:

  ```ts
  ...(dateFormat && { dateFormat }),
  ```

- [ ] **Step 3: Remove `dateFormat` from `ORGANIZATION_SELECT_FIELDS`.** Delete this line at `service.server.ts:429`:

  ```ts
  dateFormat: true,
  ```

- [ ] **Step 4: Typecheck.** Run:

  ```bash
  pnpm --filter @shelf/webapp typecheck
  ```

  Expected: PASS. `enum DateFormat` and `Organization.dateFormat` still exist in the
  schema; only the service stopped referencing them.

- [ ] **Step 5: Commit.**

  ```bash
  git commit -am "refactor(organization): drop dateFormat from updateOrganization + select
  ```

Remove the dateFormat param, its type, the data spread, and the
ORGANIZATION_SELECT_FIELDS entry. No callers reference it after the
route/form cleanup."

````

### Task 0.4: Decouple `date.tsx` and `date-format.ts` from the org preference, and revert the locations test mock

**Files:** (Modify: `apps/webapp/app/components/shared/date.tsx:2,109-127` / Modify: `apps/webapp/app/utils/date-format.ts:24` / Modify: `apps/webapp/test/routes-tests/locations.$locationId.overview.test.tsx:40-53`)
**Interfaces:** (Consumes: `resolveDateFormat(null, locale)` from `~/utils/date-format` — unchanged signature / Produces: `DateS` reverts to browser-locale (`AUTO`) formatting; `date-format.ts` no longer imports the Prisma `DateFormat` enum)

This is the last set of references to `Organization.dateFormat` / the Prisma
`DateFormat` type, so it must land before the schema removal in Task 0.5. `date.tsx`
returns to the pre-#2654 behavior by passing `null` to `resolveDateFormat` (which maps
to the browser-locale `AUTO` path). `date-format.ts` keeps all its functions intact
(Phase 2 overwrites the file) but swaps its Prisma enum import for a local literal
union so it survives the enum removal. The locations test's `useRouteLoaderData` stub
— added by #2654 solely because `DateS` began calling `useCurrentOrganization` — is
reverted, since `DateS` no longer calls it and `useHints` is fully mocked in that test.

- [ ] **Step 1: Remove the `useCurrentOrganization` import from `date.tsx`.** Delete this line at `date.tsx:2`:

```ts
import { useCurrentOrganization } from "~/hooks/use-current-organization";
````

- [ ] **Step 2: Drop the org-preference read and pass `null` to `resolveDateFormat` in `date.tsx`.** Current code at `date.tsx:109-127`:

  ```tsx
  const hints = useHints();
  // The active workspace's date-format preference (undefined outside the
  // authenticated layout, e.g. auth/onboarding pages → falls back to AUTO).
  const currentOrganization = useCurrentOrganization();
  if (!date) {
    // eslint-disable-next-line no-console
    console.warn("DateS component received null date:", date);
    return null;
  }

  // Resolve the org date-format preference. For AUTO this is a no-op (legacy
  // Accept-Language behavior); for explicit formats it overrides the locale the
  // Intl pipeline is keyed on (which reorders dates) and supplies zero-padded
  // numeric defaults for plain date displays.
  const { locale, numericDefaults } = resolveDateFormat(
    currentOrganization?.dateFormat,
    hints.locale
  );
  const hintsForFormat = locale === hints.locale ? hints : { ...hints, locale };
  ```

  Change to (remove the `currentOrganization` read; pass `null` so it resolves to the
  browser locale):

  ```tsx
  const hints = useHints();
  if (!date) {
    // eslint-disable-next-line no-console
    console.warn("DateS component received null date:", date);
    return null;
  }

  // Org-level date-format was retired; resolve with `null` so dates fall back
  // to the browser locale (the AUTO path). User-level prefs are wired later.
  const { locale, numericDefaults } = resolveDateFormat(null, hints.locale);
  const hintsForFormat = locale === hints.locale ? hints : { ...hints, locale };
  ```

- [ ] **Step 3: Replace the Prisma `DateFormat` import in `date-format.ts` with a local union.** Current code at `date-format.ts:24`:

  ```ts
  import type { DateFormat } from "@prisma/client";
  ```

  Change to (self-contained literal union; the enum is about to be removed from the
  schema and this file is fully rewritten in a later phase):

  ```ts
  /**
   * Local mirror of the retired Prisma `DateFormat` enum values. This file is
   * rewritten by the user-preference formatter work; this alias only keeps it
   * compiling after the org-level enum is removed from the schema.
   */
  type DateFormat = "AUTO" | "DD_MM_YYYY" | "MM_DD_YYYY" | "YYYY_MM_DD";
  ```

- [ ] **Step 4: Revert the `react-router` mock in the locations overview test.** Current code at `locations.$locationId.overview.test.tsx:40-53`:

  ```ts
  vi.mock("react-router", async () => {
    const actual = await vi.importActual("react-router");

    return {
      ...(actual as Record<string, unknown>),
      useLoaderData: vi.fn(),
      // why: DateS now reads the workspace date-format pref via
      // useCurrentOrganization → useRouteLoaderData. This component is rendered in
      // isolation (no data router), so stub the layout loader lookup; returning
      // undefined makes the date-format preference resolve to AUTO (legacy
      // behavior), matching this test's existing client-hints stub.
      useRouteLoaderData: vi.fn(() => undefined),
    };
  });
  ```

  Change back to the pre-#2654 mock (drop the `useRouteLoaderData` stub and its
  comment — `DateS` no longer calls `useCurrentOrganization`, and `useHints` is
  already mocked in this file):

  ```ts
  vi.mock("react-router", async () => {
    const actual = await vi.importActual("react-router");

    return {
      ...(actual as Record<string, unknown>),
      useLoaderData: vi.fn(),
    };
  });
  ```

- [ ] **Step 5: Run the existing date-format unit test — still green after the alias tweak.** Run:

  ```bash
  pnpm webapp:test -- --run apps/webapp/app/utils/date-format.test.ts
  ```

  Expected: PASS. The test only exercises `dateFormatToLocale` / `resolveDateFormat`
  with string-literal / `null` / `undefined` inputs, which the local `DateFormat`
  union still accepts.

- [ ] **Step 6: Run the locations overview test — still green after the mock revert.** Run:

  ```bash
  pnpm webapp:test -- --run apps/webapp/test/routes-tests/locations.$locationId.overview.test.tsx
  ```

  Expected: PASS.

- [ ] **Step 7: Typecheck.** Run:

  ```bash
  pnpm --filter @shelf/webapp typecheck
  ```

  Expected: PASS. Nothing references `Organization.dateFormat` or the Prisma
  `DateFormat` type anymore.

- [ ] **Step 8: Commit.**

  ```bash
  git commit -am "refactor(date): decouple DateS + date-format util from org preference
  ```

DateS falls back to the browser locale (AUTO) instead of reading the
retired org dateFormat; date-format.ts uses a local literal union in
place of the Prisma enum import. Revert the #2654 useRouteLoaderData
stub in the locations overview test."

````

### Task 0.5: Remove `Organization.dateFormat` + `enum DateFormat` from the schema

**Files:** (Modify: `packages/database/prisma/schema.prisma:972-976,1029-1037` — migration-history cleanup is owned by Phase 1 Task 1.2, not here)
**Interfaces:** (Consumes: nothing / Produces: schema has no `dateFormat`/`DateFormat`; Prisma client regenerated without them, ready for Phase 1 to add the new User enums)

No down-migration is authored: PR #2654 is unmerged so production never applied the
`20260622153058_add_organization_date_format` migration. That directory is **left in place here
and deleted in Phase 1 Task 1.2** (which owns the branch's migration history); Phase 1 also authors
the fresh migration adding the nullable User columns
(`dateFormat`/`timeFormat`/`weekStart`/`timeZone`) and the new enums
(`DateFormatPreference`/`TimeFormatPreference`/`WeekStartPreference`). Do **not** run
`db:prepare-migration` or `db:deploy-migration` here — only `db:generate`.

- [ ] **Step 1: Remove the `dateFormat` field from the `Organization` model.** Current code at `schema.prisma:972-976`:

```prisma
  // Workspace date-format preference. AUTO keeps the legacy behavior (format
  // derived from the browser Accept-Language header). Any explicit value forces
  // the ordering of dates rendered across the app (see ~/utils/date-format).
  dateFormat DateFormat @default(AUTO)
````

Delete these four lines (the surrounding `qrIdDisplayPreference` and
`showShelfBranding` fields are unchanged).

- [ ] **Step 2: Remove the `enum DateFormat` declaration.** Current code at `schema.prisma:1029-1037`:

  ```prisma
  // Workspace date-format preference. Controls how dates are rendered across the
  // app. AUTO preserves the legacy behavior (locale derived from the browser
  // Accept-Language header); the explicit values force the day/month/year order.
  enum DateFormat {
    AUTO // Browser locale (legacy default)
    DD_MM_YYYY // e.g. 03/04/2026
    MM_DD_YYYY // e.g. 04/03/2026
    YYYY_MM_DD // e.g. 2026-04-03
  }
  ```

  Delete this entire block. (Phase 1 introduces the replacement `enum
DateFormatPreference { DD_MM_YYYY MM_DD_YYYY YYYY_MM_DD }` — no `AUTO` — plus
  `TimeFormatPreference` and `WeekStartPreference` on the `User` model.)

- [ ] **Step 3: (migration history) — nothing to delete here.** The superseded
      `20260622153058_add_organization_date_format` migration dir is **deleted in Phase 1 Task 1.2**, not
      here, so a single task owns the branch's migration history. Do not `git rm` it in this task.

- [ ] **Step 4: Confirm no `dateFormat`/`DateFormat` references remain in the schema.** Run:

  ```bash
  git grep -n "DateFormat\|dateFormat" -- packages/database/prisma/schema.prisma
  ```

  Expected: no matches. (Scope to `schema.prisma` — the superseded `20260622153058_...` migration dir
  still contains `DateFormat`/`dateFormat` in its SQL until Task 1.2 deletes it; that is expected and
  not a schema reference.)

- [ ] **Step 5: Regenerate the Prisma client.** Run:

  ```bash
  pnpm db:generate
  ```

  Expected: client regenerates successfully; `@prisma/client` no longer exports
  `DateFormat` and `Organization` no longer has a `dateFormat` field.

- [ ] **Step 6: Full typecheck — the phase acceptance gate.** Run:

  ```bash
  pnpm --filter @shelf/webapp typecheck
  ```

  Expected: PASS. This is the phase-completion check: every #2654 org-level
  `dateFormat` reference is gone and the codebase compiles against a schema without
  the field/enum.

- [ ] **Step 7: Commit.**

  ```bash
  git commit -am "refactor(db): remove org dateFormat field and DateFormat enum
  ```

Retire the unmerged PR #2654 workspace date-format schema. Deletes the
Organization.dateFormat field and the DateFormat enum from schema.prisma. No
down-migration is needed since PR #2654 never reached production. The superseded
migration dir and the new user-level preference enums + migration are handled in
Phase 1 Task 1.2."

````

---

## Phase 1: Data model — user datetime-formatting preference columns

This phase lands the persistence layer for user-level date/time formatting. It adds the three
frozen Prisma enums (`DateFormatPreference`, `TimeFormatPreference`, `WeekStartPreference`) and the
four nullable `User` fields (`dateFormat`, `timeFormat`, `weekStart`, `timeZone`) exactly as fixed
in the interfaces contract. This phase is **additive-only**: Phase 0 Task 0.5 already removed the
org-level `Organization.dateFormat` + `enum DateFormat` that PR #2654 introduced (that PR is unmerged
and never reached prod), so nothing is dropped here. All new columns are nullable with no default, so
the `ALTER TABLE "User"` is metadata-only (no table rewrite). Existing rows stay `NULL` and heal lazily
in a later phase; this phase writes zero data. The migration SQL is hand-authored (per the user's
standing rule: never run `db:prepare-migration` / `db:deploy-migration`), and the Prisma client is
regenerated with `db:generate` only.

> **Cross-phase note (read before verifying):** Phase 0 (Tasks 0.1–0.5) already removed every
> org-level `Organization.dateFormat` consumer PR #2654 added — `modules/organization/service.server.ts`,
> `components/workspace/edit-form.tsx`, the deleted `components/workspace/date-format-selector.tsx`,
> `routes/_layout+/settings.general.tsx`, and `account-details.workspace.$workspaceId.edit.tsx` — and
> dropped the `dateFormat` field + `enum DateFormat` from the schema. This phase is therefore purely
> additive: `pnpm db:generate` runs `prisma generate` (validating the schema and regenerating types),
> and a repo-wide `typecheck` after this phase **passes** — the new enums + nullable `User` fields
> compile and no stale org references remain.

---

### Task 1.1: Add the three new preference enums + four nullable User fields (additive-only)

**Files:**
- Modify: `packages/database/prisma/schema.prisma:69` (add User fields after `lastMobileActiveAt`)
- Modify: `packages/database/prisma/schema.prisma` (append the three new preference enums to the enum section)

**Interfaces:**
- Produces (per contract, frozen): `enum DateFormatPreference { DD_MM_YYYY MM_DD_YYYY YYYY_MM_DD }`,
`enum TimeFormatPreference { H12 H24 }`, `enum WeekStartPreference { MONDAY SUNDAY SATURDAY }`, and
`User.dateFormat / timeFormat / weekStart / timeZone` (all nullable). These become the `@prisma/client`
types consumed by `RawFormatPrefs`, `DetectedFormatPrefs`, and the resolver in Phase 2.
- Consumes: nothing. This task is **additive-only** — Phase 0 Task 0.5 already removed
`Organization.dateFormat` and `enum DateFormat` from the schema, so there is nothing to drop here.

- [ ] **Step 1: Add the four nullable User pref fields after `lastMobileActiveAt`.**
Current code at `schema.prisma:64-71`:

```prisma
// Last time this user used the mobile companion app (any workspace). Powers
// companion-app adoption metrics from our own DB — no external analytics.
// Recorded debounced + fire-and-forget by requireMobileAuth, the chokepoint
// every mobile API route passes through. Account-level adoption = orgs with a
// recently-active member (join via UserOrganization). Null until first use.
lastMobileActiveAt DateTime?

// Relationships
````

Change to (insert the pref block between `lastMobileActiveAt` and `// Relationships`):

```prisma
// Last time this user used the mobile companion app (any workspace). Powers
// companion-app adoption metrics from our own DB — no external analytics.
// Recorded debounced + fire-and-forget by requireMobileAuth, the chokepoint
// every mobile API route passes through. Account-level adoption = orgs with a
// recently-active member (join via UserOrganization). Null until first use.
lastMobileActiveAt DateTime?

// User datetime-formatting preferences. Nullable: null = not yet detected, so
// the resolver falls back to live browser hints (today's behavior) until the
// user's next authenticated load lazily backfills concrete values. See
// ~/utils/date-format (resolveFormatPrefs / detectFormatPrefsFromHints).
dateFormat DateFormatPreference? // null → not yet detected
timeFormat TimeFormatPreference? // null → not yet detected
weekStart  WeekStartPreference?  // null → not yet detected
timeZone   String?               // IANA name; null → not yet detected

// Relationships
```

- [ ] **Step 2: Add the three new user-level preference enums.**
      Phase 0 Task 0.5 already deleted `enum DateFormat`, so there is **no block to replace** — add
      these three fresh enums to the schema's enum section (note: no `AUTO` member — a null column,
      not an enum value, encodes "not yet detected"):

  ```prisma
  // User date-format preference — controls day/month/year ordering in rendered
  // dates. Stored per-User (nullable); null resolves from live browser hints.
  enum DateFormatPreference {
    DD_MM_YYYY // e.g. 03/04/2026
    MM_DD_YYYY // e.g. 04/03/2026
    YYYY_MM_DD // e.g. 2026-04-03
  }

  // User time-format preference — 12-hour (AM/PM) vs 24-hour clock.
  enum TimeFormatPreference {
    H12 // 1:30 PM
    H24 // 13:30
  }

  // User "start of week" preference for calendar/date-picker rendering.
  enum WeekStartPreference {
    MONDAY
    SUNDAY
    SATURDAY
  }
  ```

- [ ] **Step 3: Regenerate the Prisma client (generate only — never deploy/prepare a migration).**
      Run:

  ```bash
  pnpm db:generate
  ```

  Expected: `prisma generate` completes with `Generated Prisma Client`. This both **validates the
  schema** (a malformed enum/field would fail here) and refreshes `@prisma/client` types so
  `User["dateFormat"]`, `DateFormatPreference`, etc. are importable in later phases. Do **not** run
  `pnpm db:prepare-migration` or `pnpm db:deploy-migration` — the migration is hand-authored in
  Task 1.2.

- [ ] **Step 4: Full typecheck — expected PASS.**
      Run:

  ```bash
  pnpm --filter @shelf/webapp typecheck
  ```

  Expected: **PASS**. This task is additive-only — Phase 0 already removed every org-level
  `dateFormat`/`DateFormat` consumer (`service.server.ts`, `edit-form.tsx`, the deleted
  `date-format-selector.tsx`, `settings.general.tsx`, `account-details.workspace.$workspaceId.edit.tsx`),
  so no stale references remain and the new enums + nullable `User` fields compile cleanly. If any file
  errors, the schema edit was wrong; fix before proceeding.

- [ ] **Step 5: Commit.**

  ```bash
  git commit -am "feat(db): add user datetime-format preference columns
  ```

Add DateFormatPreference/TimeFormatPreference/WeekStartPreference enums and four
nullable User fields (dateFormat, timeFormat, weekStart, timeZone). Additive-only:
the org-level Organization.dateFormat + enum DateFormat were already removed in
Phase 0. Nullable columns encode not-yet-detected and heal lazily; no backfill.
Regenerate Prisma client only."

````

---

### Task 1.2: Hand-author the migration SQL and drop the superseded #2654 migration dir

**Files:**
- Create: `packages/database/prisma/migrations/20260715120000_add_user_datetime_prefs/migration.sql`
- Delete: `packages/database/prisma/migrations/20260622153058_add_organization_date_format/` (whole dir)

**Interfaces:**
- Consumes: the schema shape produced by Task 1.1 (the SQL must exactly mirror those enums/columns).
- Produces: a single forward migration that Shelf's CI/prod applies via `prisma migrate deploy`; no
code imports from it.

- [ ] **Step 1: Delete the superseded #2654 migration directory.**
PR #2654's `20260622153058_add_organization_date_format` migration lives on this branch but is
unmerged and its column is being removed. Applying then dropping it in the same branch is churn and
leaves a `DateFormat` type/column that never should exist in prod. Remove it so the branch's
migration history is clean:

```bash
rm -rf packages/database/prisma/migrations/20260622153058_add_organization_date_format
````

Expected: directory gone. Leave every other migration dir untouched (in particular keep the
unrelated `20260622134742_add_user_mobile_activity`).

- [ ] **Step 2: Create the new migration directory + hand-authored SQL.**
      Create `packages/database/prisma/migrations/20260715120000_add_user_datetime_prefs/migration.sql`
      with exactly:

  ```sql
  -- CreateEnum
  CREATE TYPE "DateFormatPreference" AS ENUM ('DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD');

  -- CreateEnum
  CREATE TYPE "TimeFormatPreference" AS ENUM ('H12', 'H24');

  -- CreateEnum
  CREATE TYPE "WeekStartPreference" AS ENUM ('MONDAY', 'SUNDAY', 'SATURDAY');

  -- AlterTable: metadata-only (all nullable, no default → no table rewrite / no lock churn)
  ALTER TABLE "User"
    ADD COLUMN "dateFormat" "DateFormatPreference",
    ADD COLUMN "timeFormat" "TimeFormatPreference",
    ADD COLUMN "weekStart" "WeekStartPreference",
    ADD COLUMN "timeZone" TEXT;
  ```

  This migration is **additive-only**: three `CREATE TYPE` followed by the metadata-only
  `ALTER TABLE "User"` (all-nullable columns → no table rewrite, no lock churn). It contains **no**
  `DROP COLUMN`/`DROP TYPE` for `Organization.dateFormat` / `DateFormat`.

  **Why no drop?** PR #2654 is unmerged, so prod, fresh, and CI databases **never applied** its
  `20260622153058_add_organization_date_format` migration — the `Organization.dateFormat` column and
  `DateFormat` type never existed there, and a `DROP` of a nonexistent object would **fail the prod
  `migrate deploy`**. The only place those objects can exist is a local dev DB that already applied
  #2654; reconcile that machine with `pnpm db:reset` (which re-applies the clean migration history
  from scratch) — **not** with a `DROP` in this forward migration.

- [ ] **Step 3: Confirm the migration matches the schema (drift check via generate).**
      Re-run generate to confirm the schema is still valid and nothing regressed; then eyeball the
      migrations directory:

  ```bash
  pnpm db:generate && ls packages/database/prisma/migrations | grep -E 'user_datetime_prefs|organization_date_format'
  ```

  Expected: `Generated Prisma Client` succeeds; the `grep` prints `20260715120000_add_user_datetime_prefs`
  and does **not** print `20260622153058_add_organization_date_format` (confirming the delete). Do not
  run `prisma migrate deploy` here — applying migrations is out of scope for this plan.

- [ ] **Step 4: Commit.**

  ```bash
  git add packages/database/prisma/migrations
  git commit -m "feat(db): migration for user datetime prefs
  ```

Hand-authored, additive-only migration: CREATE TYPE for the three preference enums
plus a metadata-only nullable ADD COLUMN on User. No DROP for Organization.dateFormat
/ enum DateFormat — PR #2654 never reached prod/CI so those objects never existed
there; local dev DBs that applied #2654 are reconciled with db:reset. Also deletes
the superseded unmerged #2654 migration dir so branch history is clean. Applied via
migrate deploy in CI/prod; not run locally here."

````

---

## Phase 2: The pure formatter, resolver, and detectors

This phase replaces the PR #2654 `app/utils/date-format.ts` (locale-swap hack) with the
deterministic, locale-leak-free formatting core the whole feature stands on: the detectors
(`detectDateFormat` / `detectTimeFormat` / `detectWeekStart` / `detectFormatPrefsFromHints`),
the resolver (`resolveFormatPrefs`), and the pure `formatDate` — all from the frozen contract.
`formatDate` converts a UTC instant to `prefs.timeZone` via a **fixed `"en-US"`
`Intl.formatToParts`** call and then **reassembles** the parts in `prefs.dateFormat` order with
`prefs.timeFormat` (hour12), so client and server produce byte-identical output with zero locale
baggage. Everything here is pure logic → strict TDD.

> **Cross-phase note (do not "fix" here):** coming INTO this phase, app-wide `typecheck` is
> GREEN — Phase 0 deleted the workspace `DateFormatSelector` (Task 0.2) and decoupled `DateS`
> from the org preference (Task 0.4: `date.tsx` now passes `null` to `resolveDateFormat`, and
> `date-format.ts` swapped its Prisma `DateFormat` import for a local literal union), and Task
> 0.5's gate was a passing typecheck. This phase's full rewrite of `date-format.ts` DELETES the
> old exports (`dateFormatToLocale`, `NUMERIC_DATE_OPTIONS`, `resolveDateFormat`,
> `mergeDateDisplayOptions`). Their ONLY remaining consumer is `app/components/shared/date.tsx`
> (DateS), so app-wide `typecheck` will go RED on `date.tsx` AFTER this phase — that is expected
> and is repaired in Phase 3 when DateS is rewritten onto `useDateFormatter()`/`formatDate`.
> **The verification gate for every task in this phase is the module's own Vitest suite passing**
> (`pnpm webapp:test -- --run app/utils/date-format.test.ts`), which does not depend on `date.tsx`.

All runtime numbers below are proven on this repo's toolchain (Node 22.20 / ICU 77).

> **Server/client parity (spec §10) — satisfied by construction:** there is exactly ONE
> implementation of the formatter. The client hook (`useDateFormatter`, Phase 3) and the server seam
> (`resolveUserFormatPrefsById` → `formatDate`, Phases 3/7) both call the **identical pure
> `formatDate`** from `~/utils/date-format` — no parallel server-only reimplementation exists to drift
> from. So the spec's "server parity test" is met structurally: given the same `prefs` + `opts`, both
> paths produce byte-identical output because they run the same function. (Optional belt-and-braces: a
> tiny test asserting the `formatDate` referenced by the hook is the same function reference the server
> seam imports — but the single-implementation guarantee above is what actually holds parity.)

---

### Task 2.1: Types, `HARDCODED_DEFAULT_PREFS`, and the three detectors + `detectFormatPrefsFromHints`

**Files:**
- Modify (full rewrite): `apps/webapp/app/utils/date-format.ts`
- Test (full rewrite — old file tests removed exports): `apps/webapp/app/utils/date-format.test.ts`

**Interfaces:**
- Consumes: `DateFormatPreference | TimeFormatPreference | WeekStartPreference` from `@prisma/client` (Phase 1); `ClientHint` (`{ locale: string; timeZone: string }`) from `~/utils/client-hints`.
- Produces (frozen contract): types `RawFormatPrefs`, `ResolvedFormatPrefs`, `DetectedFormatPrefs`, `DateFormatOptions`; const `HARDCODED_DEFAULT_PREFS`; functions `detectDateFormat`, `detectTimeFormat`, `detectWeekStart`, `detectFormatPrefsFromHints`. (`resolveFormatPrefs`/`formatDate` land in 2.2/2.3.)

- [ ] **Step 1: Write the failing detector + type tests (overwrite the old test file).**
This replaces the entire #2654 test file (which imported `dateFormatToLocale` etc. — all gone).
Write `apps/webapp/app/utils/date-format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  HARDCODED_DEFAULT_PREFS,
  detectDateFormat,
  detectFormatPrefsFromHints,
  detectTimeFormat,
  detectWeekStart,
} from "./date-format";

describe("HARDCODED_DEFAULT_PREFS", () => {
  it("is the US-ish backstop used when there is no user + no hints", () => {
    expect(HARDCODED_DEFAULT_PREFS).toEqual({
      dateFormat: "MM_DD_YYYY",
      timeFormat: "H12",
      weekStartsOn: 0,
      timeZone: "UTC",
    });
  });
});

describe("detectDateFormat", () => {
  it("reads day/month/year part ORDER from the locale", () => {
    expect(detectDateFormat("en-US")).toBe("MM_DD_YYYY"); // m d y
    expect(detectDateFormat("en-GB")).toBe("DD_MM_YYYY"); // d m y
    expect(detectDateFormat("de-DE")).toBe("DD_MM_YYYY"); // d m y
    expect(detectDateFormat("fr-FR")).toBe("DD_MM_YYYY"); // d m y
    expect(detectDateFormat("en-CA")).toBe("YYYY_MM_DD"); // y m d
    expect(detectDateFormat("ja-JP")).toBe("YYYY_MM_DD"); // y m d
  });
});

describe("detectTimeFormat", () => {
  it("maps hour12 → H12/H24", () => {
    expect(detectTimeFormat("en-US")).toBe("H12");
    expect(detectTimeFormat("en-CA")).toBe("H12");
    expect(detectTimeFormat("en-GB")).toBe("H24");
    expect(detectTimeFormat("de-DE")).toBe("H24");
    expect(detectTimeFormat("ja-JP")).toBe("H24");
    expect(detectTimeFormat("fr-FR")).toBe("H24");
  });
});

describe("detectWeekStart", () => {
  it("maps weekInfo.firstDay (ISO 1..7) to the enum", () => {
    expect(detectWeekStart("en-US")).toBe("SUNDAY"); // firstDay 7
    expect(detectWeekStart("en-CA")).toBe("SUNDAY"); // firstDay 7
    expect(detectWeekStart("ja-JP")).toBe("SUNDAY"); // firstDay 7
    expect(detectWeekStart("en-GB")).toBe("MONDAY"); // firstDay 1
    expect(detectWeekStart("de-DE")).toBe("MONDAY"); // firstDay 1
    expect(detectWeekStart("fr-FR")).toBe("MONDAY"); // firstDay 1
  });

  it("never throws on a junk locale (region/default fallback)", () => {
    expect(() => detectWeekStart("xx-INVALID")).not.toThrow();
    expect(["MONDAY", "SUNDAY", "SATURDAY"]).toContain(
      detectWeekStart("xx-INVALID")
    );
  });
});

describe("detectFormatPrefsFromHints", () => {
  it("produces all four concrete prefs from locale + timeZone", () => {
    expect(
      detectFormatPrefsFromHints({ locale: "en-GB", timeZone: "Europe/London" })
    ).toEqual({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "Europe/London",
    });
    expect(
      detectFormatPrefsFromHints({ locale: "en-US", timeZone: "America/New_York" })
    ).toEqual({
      dateFormat: "MM_DD_YYYY",
      timeFormat: "H12",
      weekStart: "SUNDAY",
      timeZone: "America/New_York",
    });
  });

  it("carries the timeZone hint through verbatim", () => {
    expect(
      detectFormatPrefsFromHints({ locale: "ja-JP", timeZone: "Asia/Tokyo" }).timeZone
    ).toBe("Asia/Tokyo");
  });
});
````

- [ ] **Step 2: Run the test — expect FAIL (module has no such exports yet).**

  ```bash
  pnpm webapp:test -- --run app/utils/date-format.test.ts
  ```

  Expected: fails to resolve imports / `detectDateFormat is not a function`.

- [ ] **Step 3: Write the module header + contract types (overwrite `date-format.ts` top).**
      Overwrite the whole file; this step lays down the file-level JSDoc and the four exported types +
      the default const. (Detectors/resolver/formatter appended in later steps/tasks.)

  ```ts
  /**
   * Pure, locale-leak-free date/time formatting core.
   *
   * The fix for PR #2654's locale-baggage bug: we NEVER swap the Intl locale to
   * change day/month/year order. Instead we (1) convert the UTC instant to the
   * user's timezone with a FIXED `"en-US"` `Intl.formatToParts` call — Intl is
   * used only for its correct timezone math and English month/weekday names —
   * then (2) REASSEMBLE the numeric parts in the user's `dateFormat` order with
   * their `timeFormat` (hour12). Output is deterministic and byte-identical on
   * client and server.
   *
   * Detection maps browser hints (locale + timeZone) to concrete enum values,
   * stored on the User row at creation and lazily backfilled thereafter.
   *
   * @see {@link file://./client-hints.tsx} ClientHint / getClientHint
   * @see {@link file://./date-format.server.ts} resolveUserFormatPrefsById
   * @see {@link file://../components/shared/date.tsx} DateS (Phase 3 consumer)
   */
  import type {
    DateFormatPreference,
    TimeFormatPreference,
    WeekStartPreference,
  } from "@prisma/client";
  import type { ClientHint } from "~/utils/client-hints";

  /** Raw, possibly-unset user prefs (mirrors the nullable DB columns). */
  export type RawFormatPrefs = {
    dateFormat: DateFormatPreference | null;
    timeFormat: TimeFormatPreference | null;
    weekStart: WeekStartPreference | null;
    timeZone: string | null;
  };

  /** Fully-resolved concrete prefs the formatter consumes. */
  export type ResolvedFormatPrefs = {
    dateFormat: DateFormatPreference;
    timeFormat: TimeFormatPreference;
    /** react-day-picker convention: Sun=0, Mon=1, Sat=6. */
    weekStartsOn: 0 | 1 | 6;
    timeZone: string;
  };

  /** Concrete prefs detected from browser hints, ready to STORE on a User row. */
  export type DetectedFormatPrefs = {
    dateFormat: DateFormatPreference;
    timeFormat: TimeFormatPreference;
    weekStart: WeekStartPreference;
    timeZone: string;
  };

  /**
   * The hardcoded backstop for no-user / no-hints contexts (cron, invites to
   * unregistered emails). US-ish per the locked design decision.
   */
  export const HARDCODED_DEFAULT_PREFS: ResolvedFormatPrefs = {
    dateFormat: "MM_DD_YYYY",
    timeFormat: "H12",
    weekStartsOn: 0,
    timeZone: "UTC",
  };

  /** Superset of the option shapes DateS callers pass today (facts-02 §C). */
  export type DateFormatOptions = {
    weekday?: "long" | "short" | "narrow";
    year?: "numeric" | "2-digit";
    month?: "numeric" | "2-digit" | "short" | "long";
    day?: "numeric" | "2-digit";
    hour?: "numeric" | "2-digit";
    minute?: "numeric" | "2-digit";
    dateStyle?: "short" | "medium" | "long";
    timeStyle?: "short" | "long";
    includeTime?: boolean;
    onlyTime?: boolean;
    /** Absolute date, no timezone conversion (working-hours overrides). */
    localeOnly?: boolean;
  };
  ```

- [ ] **Step 4: Append the three detectors + `detectFormatPrefsFromHints`.**
      Add to `date-format.ts`:

  ```ts
  /** Unambiguous reference date (day 3 ≠ month 4) for reading part order. */
  const DATE_ORDER_REF_DATE = new Date(Date.UTC(2026, 3, 3));

  /**
   * Detect the day/month/year ordering of a locale's short numeric date.
   *
   * @param locale - BCP-47 locale (e.g. "en-GB")
   * @returns the matching {@link DateFormatPreference}
   */
  export function detectDateFormat(locale: string): DateFormatPreference {
    let order: string;
    try {
      const parts = new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).formatToParts(DATE_ORDER_REF_DATE);
      order = parts
        .filter(
          (p) => p.type === "year" || p.type === "month" || p.type === "day"
        )
        .map((p) => p.type[0]) // "y" | "m" | "d"
        .join("");
    } catch {
      return HARDCODED_DEFAULT_PREFS.dateFormat;
    }
    if (order[0] === "y") return "YYYY_MM_DD";
    if (order.indexOf("d") < order.indexOf("m")) return "DD_MM_YYYY";
    return "MM_DD_YYYY";
  }

  /**
   * Detect 12h vs 24h from the locale's resolved `hour12`.
   *
   * @param locale - BCP-47 locale
   * @returns "H12" or "H24"
   */
  export function detectTimeFormat(locale: string): TimeFormatPreference {
    try {
      const hour12 = new Intl.DateTimeFormat(locale, {
        hour: "numeric",
      }).resolvedOptions().hour12;
      return hour12 ? "H12" : "H24";
    } catch {
      return HARDCODED_DEFAULT_PREFS.timeFormat;
    }
  }

  /** Locale-region fallback: regions whose calendars start on Sunday. */
  const SUNDAY_START_REGIONS = new Set([
    "US",
    "CA",
    "AU",
    "JP",
    "IL",
    "MX",
    "ZA",
    "BR",
    "PH",
    "KR",
    "IN",
    "HK",
    "TW",
  ]);

  /**
   * Read `Intl.Locale#weekInfo.firstDay` (ISO 1..7, Mon..Sun) where the engine
   * supports it. Returns null if unsupported/invalid so the caller can fall back.
   */
  function getLocaleFirstDay(locale: string): number | null {
    try {
      const loc = new Intl.Locale(locale) as Intl.Locale & {
        weekInfo?: { firstDay?: number };
        getWeekInfo?: () => { firstDay?: number };
      };
      const info =
        typeof loc.getWeekInfo === "function"
          ? loc.getWeekInfo()
          : loc.weekInfo;
      return info?.firstDay ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Detect the locale's start-of-week, with a region-table fallback when the
   * engine lacks `weekInfo`.
   *
   * @param locale - BCP-47 locale
   * @returns the matching {@link WeekStartPreference}
   */
  export function detectWeekStart(locale: string): WeekStartPreference {
    const firstDay = getLocaleFirstDay(locale);
    if (firstDay === 7) return "SUNDAY";
    if (firstDay === 6) return "SATURDAY";
    if (firstDay != null) return "MONDAY"; // 1 (Mon) or the uncommon 2..5
    // weekInfo unsupported → region table (default MONDAY).
    let region: string | undefined;
    try {
      region = new Intl.Locale(locale).region ?? undefined;
    } catch {
      region = undefined;
    }
    return region && SUNDAY_START_REGIONS.has(region) ? "SUNDAY" : "MONDAY";
  }

  /**
   * Map browser hints to the four concrete prefs to STORE on a User row
   * (user creation + lazy backfill).
   *
   * @param hints - `{ locale, timeZone }`
   * @returns concrete {@link DetectedFormatPrefs}
   */
  export function detectFormatPrefsFromHints(
    hints: ClientHint
  ): DetectedFormatPrefs {
    return {
      dateFormat: detectDateFormat(hints.locale),
      timeFormat: detectTimeFormat(hints.locale),
      weekStart: detectWeekStart(hints.locale),
      timeZone: hints.timeZone,
    };
  }
  ```

- [ ] **Step 5: Run the test — expect PASS.**

  ```bash
  pnpm webapp:test -- --run app/utils/date-format.test.ts
  ```

  Expected: all `describe` blocks green.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/webapp/app/utils/date-format.ts apps/webapp/app/utils/date-format.test.ts
  git commit -m "feat(date-format): add format-pref types + browser-hint detectors
  ```

Rewrite date-format.ts core: RawFormatPrefs/ResolvedFormatPrefs/DetectedFormatPrefs/
DateFormatOptions types, HARDCODED_DEFAULT_PREFS, and detectDateFormat/detectTimeFormat/
detectWeekStart/detectFormatPrefsFromHints. Detectors read locale part-order, hour12,
and weekInfo.firstDay with a region fallback. Replaces the #2654 locale-swap exports."

````

---

### Task 2.2: `resolveFormatPrefs` — raw prefs (+ optional hints) → concrete prefs

**Files:**
- Modify: `apps/webapp/app/utils/date-format.ts`
- Test: `apps/webapp/app/utils/date-format.test.ts`

**Interfaces:**
- Consumes: `RawFormatPrefs`, `ClientHint`, `detectFormatPrefsFromHints`, `HARDCODED_DEFAULT_PREFS` (Task 2.1).
- Produces (contract): `resolveFormatPrefs(userPrefs: RawFormatPrefs | null, hints: ClientHint | null): ResolvedFormatPrefs`. Per field precedence: **stored value → detect-from-hints → hardcoded default**. `weekStart` enum maps to `weekStartsOn`: MONDAY→1, SUNDAY→0, SATURDAY→6.

- [ ] **Step 1: Add failing resolver tests.**
Append to `apps/webapp/app/utils/date-format.test.ts`:
```ts
import { resolveFormatPrefs } from "./date-format";

describe("resolveFormatPrefs", () => {
  const enGB = { locale: "en-GB", timeZone: "Europe/London" };

  it("prefers stored values over hints and defaults", () => {
    const r = resolveFormatPrefs(
      {
        dateFormat: "YYYY_MM_DD",
        timeFormat: "H24",
        weekStart: "SATURDAY",
        timeZone: "Asia/Tokyo",
      },
      enGB
    );
    expect(r).toEqual({
      dateFormat: "YYYY_MM_DD",
      timeFormat: "H24",
      weekStartsOn: 6,
      timeZone: "Asia/Tokyo",
    });
  });

  it("falls back per-null-field to hint detection", () => {
    const r = resolveFormatPrefs(
      { dateFormat: null, timeFormat: null, weekStart: null, timeZone: null },
      enGB
    );
    expect(r).toEqual({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStartsOn: 1, // MONDAY
      timeZone: "Europe/London",
    });
  });

  it("mixes stored + hint-detected fields independently", () => {
    const r = resolveFormatPrefs(
      { dateFormat: "MM_DD_YYYY", timeFormat: null, weekStart: null, timeZone: null },
      enGB
    );
    expect(r.dateFormat).toBe("MM_DD_YYYY"); // stored
    expect(r.timeFormat).toBe("H24"); // detected from en-GB
    expect(r.weekStartsOn).toBe(1); // detected from en-GB
    expect(r.timeZone).toBe("Europe/London"); // hint
  });

  it("uses the hardcoded default when there is neither a user nor hints", () => {
    expect(resolveFormatPrefs(null, null)).toEqual(HARDCODED_DEFAULT_PREFS);
  });

  it("maps the weekStart enum to weekStartsOn (MONDAY→1, SUNDAY→0, SATURDAY→6)", () => {
    const base = { dateFormat: null, timeFormat: null, timeZone: null } as const;
    expect(
      resolveFormatPrefs({ ...base, weekStart: "MONDAY" }, null).weekStartsOn
    ).toBe(1);
    expect(
      resolveFormatPrefs({ ...base, weekStart: "SUNDAY" }, null).weekStartsOn
    ).toBe(0);
    expect(
      resolveFormatPrefs({ ...base, weekStart: "SATURDAY" }, null).weekStartsOn
    ).toBe(6);
  });
});
````

- [ ] **Step 2: Run — expect FAIL.**

  ```bash
  pnpm webapp:test -- --run app/utils/date-format.test.ts
  ```

  Expected: `resolveFormatPrefs is not a function`.

- [ ] **Step 3: Implement `resolveFormatPrefs` + the enum→index helper.**
      Append to `date-format.ts`:

  ```ts
  /** Map the WeekStartPreference enum to react-day-picker's day index. */
  function weekStartEnumToIndex(weekStart: WeekStartPreference): 0 | 1 | 6 {
    switch (weekStart) {
      case "MONDAY":
        return 1;
      case "SATURDAY":
        return 6;
      case "SUNDAY":
      default:
        return 0;
    }
  }

  /**
   * Resolve raw (possibly-null) user prefs against optional browser hints into
   * fully concrete prefs. This is the ONLY place a `null` field is interpreted:
   * per field, stored value → detect-from-hints → {@link HARDCODED_DEFAULT_PREFS}.
   *
   * @param userPrefs - the user's raw prefs, or null (no session)
   * @param hints - browser hints, or null (no request context)
   * @returns concrete {@link ResolvedFormatPrefs}
   */
  export function resolveFormatPrefs(
    userPrefs: RawFormatPrefs | null,
    hints: ClientHint | null
  ): ResolvedFormatPrefs {
    // Detect once; each field falls back to its detected value independently.
    const detected = hints ? detectFormatPrefsFromHints(hints) : null;

    const weekStartEnum = userPrefs?.weekStart ?? detected?.weekStart ?? null;

    return {
      dateFormat:
        userPrefs?.dateFormat ??
        detected?.dateFormat ??
        HARDCODED_DEFAULT_PREFS.dateFormat,
      timeFormat:
        userPrefs?.timeFormat ??
        detected?.timeFormat ??
        HARDCODED_DEFAULT_PREFS.timeFormat,
      weekStartsOn: weekStartEnum
        ? weekStartEnumToIndex(weekStartEnum)
        : HARDCODED_DEFAULT_PREFS.weekStartsOn,
      timeZone:
        userPrefs?.timeZone ??
        detected?.timeZone ??
        HARDCODED_DEFAULT_PREFS.timeZone,
    };
  }
  ```

- [ ] **Step 4: Run — expect PASS.**

  ```bash
  pnpm webapp:test -- --run app/utils/date-format.test.ts
  ```

  Expected: resolver block green (detectors from 2.1 still green).

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/webapp/app/utils/date-format.ts apps/webapp/app/utils/date-format.test.ts
  git commit -m "feat(date-format): add resolveFormatPrefs precedence resolver
  ```

Per-field precedence stored value -> hint detection -> HARDCODED_DEFAULT_PREFS, with the
WeekStartPreference enum mapped to react-day-picker's weekStartsOn index (MONDAY 1,
SUNDAY 0, SATURDAY 6). Only place a null pref field is interpreted."

````

---

### Task 2.3: `formatDate` — the pure reassembling formatter

**Files:**
- Modify: `apps/webapp/app/utils/date-format.ts`
- Test: `apps/webapp/app/utils/date-format.test.ts`

**Interfaces:**
- Consumes: `ResolvedFormatPrefs`, `DateFormatOptions` (Task 2.1).
- Produces (contract): `formatDate(value: string | Date, prefs: ResolvedFormatPrefs, opts?: DateFormatOptions): string`. Converts UTC → `prefs.timeZone` via fixed-`"en-US"` `formatToParts`, reassembles per `prefs.dateFormat` order + separator with `prefs.timeFormat` (hour12). `localeOnly` skips tz conversion. `dateStyle`/`timeStyle` presets are mapped to explicit fields internally so Intl never sees a style+granular mix.

- [ ] **Step 1: Add failing core `formatDate` tests (behavioral, byte-exact).**
Append to `apps/webapp/app/utils/date-format.test.ts`. These pin the reassembly, DST, onlyTime,
localeOnly, and time-preset behavior (all validated on Node 22 / ICU 77):
```ts
import { formatDate } from "./date-format";
import type { ResolvedFormatPrefs } from "./date-format";

// Reference prefs across three orderings / time formats / timezones.
const US: ResolvedFormatPrefs = {
  dateFormat: "MM_DD_YYYY", timeFormat: "H12", weekStartsOn: 0, timeZone: "America/New_York",
};
const GB: ResolvedFormatPrefs = {
  dateFormat: "DD_MM_YYYY", timeFormat: "H24", weekStartsOn: 1, timeZone: "Europe/Sofia",
};
const CA: ResolvedFormatPrefs = {
  dateFormat: "YYYY_MM_DD", timeFormat: "H24", weekStartsOn: 0, timeZone: "Asia/Tokyo",
};
// UTC 2026-06-22T21:05 → NY 17:05 (same day), Tokyo 06:05 (next day), Sofia 00:05 (next day).
const V = "2026-06-22T21:05:00Z";

describe("formatDate — reassembly + timezone conversion", () => {
  it("plain numeric is zero-padded 4-digit-year in the pref order", () => {
    expect(formatDate(V, US)).toBe("06/22/2026");
    expect(formatDate(V, GB)).toBe("23/06/2026"); // Sofia next day
    expect(formatDate(V, CA)).toBe("2026-06-23"); // Tokyo next day, ISO separator
  });

  it("converts the UTC instant to the pref timezone (cross-day boundaries)", () => {
    expect(formatDate(V, CA, { includeTime: true })).toBe("2026-06-23, 06:05");
    expect(formatDate(V, GB, { includeTime: true })).toBe("23/06/2026, 00:05");
  });

  it("honors H12 vs H24 for the time portion", () => {
    expect(formatDate(V, US, { onlyTime: true })).toBe("5:05 PM");
    expect(formatDate(V, GB, { onlyTime: true })).toBe("00:05");
  });

  it("localeOnly skips tz conversion (uses the wall-clock date as-is)", () => {
    // Date-only string: no shift regardless of the (America/New_York) tz.
    expect(formatDate("2026-06-22", US, { localeOnly: true })).toBe("06/22/2026");
  });

  it("handles a DST (winter) boundary correctly", () => {
    // UTC 05:30 in Jan → America/New_York (EST) 00:30 same day.
    expect(
      formatDate("2026-01-15T05:30:00Z", US, { dateStyle: "short", timeStyle: "short" })
    ).toBe("01/15/2026, 12:30 AM");
  });

  it("timeStyle:short maps to hour+minute; timeStyle:long appends the tz name", () => {
    expect(formatDate(V, US, { timeStyle: "short" })).toBe("5:05 PM");
    expect(formatDate(V, US, { dateStyle: "short", timeStyle: "long" })).toBe(
      "06/22/2026, 5:05 PM EDT"
    );
  });

  it("accepts a Date instance identically to an ISO string", () => {
    expect(formatDate(new Date(V), US)).toBe(formatDate(V, US));
  });
});

describe("formatDate — previously-broken cases (bug regressions)", () => {
  it("bug #1: YYYY_MM_DD with a month NAME stays year-first (not month-first)", () => {
    expect(
      formatDate(V, CA, { month: "short", day: "numeric", year: "numeric" })
    ).toBe("2026 Jun 23");
  });

  it("bug #2: dateStyle:short matches the numeric path (padded, 4-digit year)", () => {
    expect(formatDate(V, US, { dateStyle: "short" })).toBe(formatDate(V, US));
    expect(formatDate(V, US, { dateStyle: "short" })).toBe("06/22/2026");
  });

  it("bug #3: a partial {month,day} adds NO year", () => {
    expect(formatDate(V, US, { month: "short", day: "numeric" })).toBe("Jun 22");
    expect(formatDate(V, GB, { month: "short", day: "numeric" })).toBe("23 Jun");
  });
});
````

- [ ] **Step 2: Run — expect FAIL.**

  ```bash
  pnpm webapp:test -- --run app/utils/date-format.test.ts
  ```

  Expected: `formatDate is not a function`.

- [ ] **Step 3: Implement the preset tables + option normalizer.**
      Append to `date-format.ts`. Presets map to EXPLICIT fields so Intl never sees style+granular
      together (the #2654 TypeError trap disappears — we control assembly):

  ```ts
  /** Order + numeric separator for each date-format preference. */
  const DATE_ORDER: Record<
    DateFormatPreference,
    {
      order: [
        "day" | "month" | "year",
        "day" | "month" | "year",
        "day" | "month" | "year",
      ];
      separator: string;
    }
  > = {
    DD_MM_YYYY: { order: ["day", "month", "year"], separator: "/" },
    MM_DD_YYYY: { order: ["month", "day", "year"], separator: "/" },
    YYYY_MM_DD: { order: ["year", "month", "day"], separator: "-" },
  };

  /** dateStyle preset → explicit fields. `short` is zero-padded, 4-digit year. */
  const DATE_STYLE_PRESETS: Record<
    NonNullable<DateFormatOptions["dateStyle"]>,
    Pick<DateFormatOptions, "year" | "month" | "day">
  > = {
    short: { year: "numeric", month: "2-digit", day: "2-digit" },
    medium: { year: "numeric", month: "short", day: "numeric" },
    long: { year: "numeric", month: "long", day: "numeric" },
  };

  /** timeStyle preset → explicit fields (`long` adds a short tz name). */
  const TIME_STYLE_PRESETS: Record<
    NonNullable<DateFormatOptions["timeStyle"]>,
    { hour: "numeric"; minute: "2-digit"; timeZoneName?: "short" }
  > = {
    short: { hour: "numeric", minute: "2-digit" },
    long: { hour: "numeric", minute: "2-digit", timeZoneName: "short" },
  };

  /** Zero-pad a numeric string part to two digits. */
  function pad2(value: string): string {
    return value.length >= 2 ? value : `0${value}`.slice(-2);
  }

  /**
   * Run a fixed-"en-US" formatToParts against the instant and return a
   * type→value map (literals dropped). `timeZone` undefined ⇒ no conversion.
   */
  function partsFor(
    date: Date,
    timeZone: string | undefined,
    intlOptions: Intl.DateTimeFormatOptions
  ): Record<string, string> {
    const options: Intl.DateTimeFormatOptions = { ...intlOptions };
    if (timeZone) options.timeZone = timeZone;
    const map: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat("en-US", options).formatToParts(
      date
    )) {
      if (part.type !== "literal") map[part.type] = part.value;
    }
    return map;
  }

  /** Normalized, assembly-ready view of the caller's DateFormatOptions. */
  type NormalizedOptions = {
    wantDate: boolean;
    wantTime: boolean;
    includeYear: boolean;
    includeMonth: boolean;
    includeDay: boolean;
    weekday?: "long" | "short" | "narrow";
    monthStyle: "numeric" | "2-digit" | "short" | "long";
    yearStyle: "numeric" | "2-digit";
    dayStyle: "numeric" | "2-digit";
    hourStyle: "numeric" | "2-digit";
    timeZoneName?: "short";
  };

  /**
   * Fold dateStyle/timeStyle presets + granular fields into one explicit spec,
   * deciding which date/time pieces to render. Defaults (no explicit fields) =
   * canonical zero-padded numeric date, matching the DateFormatPreference token
   * (e.g. MM/dd/yyyy) so dateStyle:short and the plain path agree (bug #2).
   */
  function normalizeOptions(opts: DateFormatOptions): NormalizedOptions {
    const fromDateStyle = opts.dateStyle
      ? DATE_STYLE_PRESETS[opts.dateStyle]
      : {};
    const fromTimeStyle = opts.timeStyle
      ? TIME_STYLE_PRESETS[opts.timeStyle]
      : {};
    const granular: Pick<
      DateFormatOptions,
      "weekday" | "year" | "month" | "day" | "hour" | "minute"
    > = {};
    for (const key of [
      "weekday",
      "year",
      "month",
      "day",
      "hour",
      "minute",
    ] as const) {
      if (opts[key] != null) granular[key] = opts[key] as never;
    }
    const merged = { ...fromDateStyle, ...fromTimeStyle, ...granular };
    const anyExplicit =
      Object.keys(merged).length > 0 ||
      Boolean(opts.dateStyle) ||
      Boolean(opts.timeStyle);

    const wantTime =
      opts.onlyTime === true ||
      Boolean(opts.timeStyle) ||
      merged.hour != null ||
      merged.minute != null ||
      (opts.includeTime === true && !opts.dateStyle);

    const wantDate = opts.onlyTime
      ? false
      : Boolean(opts.dateStyle) ||
        merged.weekday != null ||
        merged.year != null ||
        merged.month != null ||
        merged.day != null ||
        !anyExplicit; // bare call ⇒ full numeric date

    // Field inclusion: explicit ⇒ only requested date fields; bare ⇒ all three.
    const includeYear =
      wantDate &&
      (merged.year != null || Boolean(opts.dateStyle) || !anyExplicit);
    const includeMonth =
      wantDate &&
      (merged.month != null || Boolean(opts.dateStyle) || !anyExplicit);
    const includeDay =
      wantDate &&
      (merged.day != null || Boolean(opts.dateStyle) || !anyExplicit);

    return {
      wantDate,
      wantTime,
      includeYear,
      includeMonth,
      includeDay,
      weekday: merged.weekday,
      monthStyle: merged.month ?? "2-digit",
      yearStyle: merged.year ?? "numeric",
      dayStyle: merged.day ?? "2-digit",
      hourStyle: merged.hour ?? "numeric",
      timeZoneName: fromTimeStyle.timeZoneName,
    };
  }
  ```

- [ ] **Step 4: Implement the name-month renderer + `formatDate` itself.**
      Append to `date-format.ts`:

  ```ts
  /**
   * Render a date whose month is an English NAME, in the English convention for
   * the given ordering: "Jun 22, 2026" (M-D-Y), "22 Jun 2026" (D-M-Y),
   * "2026 Jun 22" (Y-M-D). Only fields flagged active are included.
   */
  function renderNameMonth(
    activeOrder: ("day" | "month" | "year")[],
    rendered: { day: string; month: string; year: string },
    dateFormat: DateFormatPreference
  ): string {
    if (dateFormat === "MM_DD_YYYY") {
      const hasYear = activeOrder.includes("year");
      const monthDay = activeOrder
        .filter((f) => f !== "year")
        .map((f) => rendered[f])
        .join(" ");
      return hasYear ? `${monthDay}, ${rendered.year}` : monthDay;
    }
    // D-M-Y and Y-M-D: space-separated, no comma.
    return activeOrder.map((f) => rendered[f]).join(" ");
  }

  /**
   * The pure formatter. Converts `value` (UTC instant) to `prefs.timeZone` and
   * reassembles the parts in `prefs.dateFormat` order using `prefs.timeFormat`.
   * Identical output on client and server; no locale leakage.
   *
   * @param value - a Date or an ISO/parseable date string (interpreted as UTC)
   * @param prefs - resolved user prefs (order, hour12, timezone)
   * @param opts - optional field/preset selection (DateS-compatible superset)
   * @returns the formatted string (date, time, or "date, time")
   */
  export function formatDate(
    value: string | Date,
    prefs: ResolvedFormatPrefs,
    opts: DateFormatOptions = {}
  ): string {
    const date = value instanceof Date ? value : new Date(value);
    const timeZone = opts.localeOnly ? undefined : prefs.timeZone;
    const n = normalizeOptions(opts);

    // One conversion for all numeric parts (year/month/day/hour/minute) in tz.
    const numeric = partsFor(date, timeZone, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: prefs.timeFormat === "H12",
    });

    const out: string[] = [];

    if (n.wantDate) {
      const { order, separator } = DATE_ORDER[prefs.dateFormat];
      const isNameMonth = n.monthStyle === "short" || n.monthStyle === "long";

      const rendered = {
        year: n.yearStyle === "2-digit" ? numeric.year.slice(-2) : numeric.year,
        month: isNameMonth
          ? partsFor(date, timeZone, { month: n.monthStyle }).month // English name
          : n.monthStyle === "2-digit"
          ? pad2(numeric.month)
          : numeric.month,
        day: n.dayStyle === "2-digit" ? pad2(numeric.day) : numeric.day,
      };

      const include = {
        year: n.includeYear,
        month: n.includeMonth,
        day: n.includeDay,
      };
      const activeOrder = order.filter((field) => include[field]);

      let dateStr = isNameMonth
        ? renderNameMonth(activeOrder, rendered, prefs.dateFormat)
        : activeOrder.map((field) => rendered[field]).join(separator);

      if (n.weekday != null) {
        const weekday = partsFor(date, timeZone, {
          weekday: n.weekday,
        }).weekday;
        dateStr = dateStr ? `${weekday}, ${dateStr}` : weekday;
      }
      if (dateStr) out.push(dateStr);
    }

    if (n.wantTime) {
      let timeStr: string;
      if (prefs.timeFormat === "H12") {
        // Intl already yields "5", "05", "PM" for hour12 — read them directly.
        const dp = partsFor(date, timeZone, {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        timeStr = `${dp.hour}:${dp.minute} ${dp.dayPeriod}`;
      } else {
        const hour =
          n.hourStyle === "2-digit" ? pad2(numeric.hour) : numeric.hour;
        timeStr = `${hour}:${numeric.minute}`;
      }
      if (n.timeZoneName) {
        const tzName = partsFor(date, timeZone, {
          hour: "numeric",
          timeZoneName: n.timeZoneName,
          hour12: prefs.timeFormat === "H12",
        }).timeZoneName;
        timeStr = `${timeStr} ${tzName}`;
      }
      out.push(timeStr);
    }

    return out.join(", ");
  }
  ```

- [ ] **Step 5: Run — expect PASS.**

  ```bash
  pnpm webapp:test -- --run app/utils/date-format.test.ts
  ```

  Expected: all core + bug-regression cases green (outputs were validated against Node 22 / ICU 77).

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/webapp/app/utils/date-format.ts apps/webapp/app/utils/date-format.test.ts
  git commit -m "feat(date-format): add pure reassembling formatDate
  ```

Converts a UTC instant to prefs.timeZone via a fixed en-US formatToParts, then reassembles
the numeric parts in prefs.dateFormat order (separator per format) with prefs.timeFormat
hour12. dateStyle/timeStyle presets map to explicit fields internally so Intl never sees a
style+granular mix. Fixes the #2654 regressions: YYYY-MM-DD name-months stay year-first,
dateStyle:short matches the padded numeric path, and partial {month,day} adds no year."

````

---

### Task 2.4: Full option-shape coverage (facts-02 §C1–C10) + cross-locale detector sweep

**Files:**
- Test: `apps/webapp/app/utils/date-format.test.ts`
- (Modify `apps/webapp/app/utils/date-format.ts` only if a §C shape reveals a gap.)

**Interfaces:**
- Consumes: `formatDate`, `resolveFormatPrefs`, `detect*` (Tasks 2.1–2.3). Produces: no new exports — this task locks the compatibility surface every DateS caller relies on before Phase 3 rewires `DateS`.

- [ ] **Step 1: Add the §C option-shape coverage tests.**
Every distinct `DateS options` shape from facts-02 §C1–C10, asserted across two orderings so a
future assembly regression is caught. Append to `apps/webapp/app/utils/date-format.test.ts`:
```ts
describe("formatDate — DateS option-shape coverage (facts-02 §C)", () => {
  // C1 (13×): { dateStyle: "short", timeStyle: "short" }
  it("C1 date+time preset", () => {
    expect(formatDate(V, US, { dateStyle: "short", timeStyle: "short" })).toBe(
      "06/22/2026, 5:05 PM"
    );
    expect(formatDate(V, GB, { dateStyle: "short", timeStyle: "short" })).toBe(
      "23/06/2026, 00:05"
    );
  });

  // C2: { dateStyle: "short", timeStyle: "long" }
  it("C2 date + long-tz time preset", () => {
    expect(formatDate(V, US, { dateStyle: "short", timeStyle: "long" })).toBe(
      "06/22/2026, 5:05 PM EDT"
    );
  });

  // C3: { timeStyle: "short" }
  it("C3 time-only preset", () => {
    expect(formatDate(V, US, { timeStyle: "short" })).toBe("5:05 PM");
    expect(formatDate(V, GB, { timeStyle: "short" })).toBe("00:05");
  });

  // C4 (5×): { month: "short", day: "numeric" } — NO year
  it("C4 field-part, no year", () => {
    expect(formatDate(V, US, { month: "short", day: "numeric" })).toBe("Jun 22");
    expect(formatDate(V, GB, { month: "short", day: "numeric" })).toBe("23 Jun");
  });

  // C5: { month: "short", day: "numeric", year: "numeric" }
  it("C5 field-part with year", () => {
    expect(
      formatDate(V, US, { month: "short", day: "numeric", year: "numeric" })
    ).toBe("Jun 22, 2026");
    expect(
      formatDate(V, GB, { month: "short", day: "numeric", year: "numeric" })
    ).toBe("23 Jun 2026");
  });

  // C6: { month: "long", day: "numeric", year: "numeric" }
  it("C6 long month with year", () => {
    expect(
      formatDate(V, US, { month: "long", day: "numeric", year: "numeric" })
    ).toBe("June 22, 2026");
    expect(
      formatDate(V, GB, { month: "long", day: "numeric", year: "numeric" })
    ).toBe("23 June 2026");
  });

  // C7: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
  it("C7 mixed date + time fields", () => {
    expect(
      formatDate(V, US, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    ).toBe("Jun 22, 5:05 PM");
  });

  // C8: { weekday: "long", month: "long", day: "numeric", year: "numeric" }
  it("C8 full weekday + long date", () => {
    expect(
      formatDate(V, US, {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      })
    ).toBe("Monday, June 22, 2026");
  });

  // C9: key-order variant of C1 — must equal C1.
  it("C9 timeStyle/dateStyle key order is irrelevant", () => {
    expect(formatDate(V, US, { timeStyle: "short", dateStyle: "short" })).toBe(
      formatDate(V, US, { dateStyle: "short", timeStyle: "short" })
    );
  });

  // C10: dynamic {month:"short", day:"numeric", (year:"numeric")?} — both branches.
  it("C10 dynamically-built field-part options (with/without year)", () => {
    const withoutYear: DateFormatOptions = { month: "short", day: "numeric" };
    const withYear: DateFormatOptions = { month: "short", day: "numeric", year: "numeric" };
    expect(formatDate(V, US, withoutYear)).toBe("Jun 22");
    expect(formatDate(V, US, withYear)).toBe("Jun 22, 2026");
  });
});
````

(Add `import type { DateFormatOptions } from "./date-format";` to the existing import block at the
top of the test file if not already present.)

- [ ] **Step 2: Add the cross-locale detector sweep as a table test.**
      Append to `apps/webapp/app/utils/date-format.test.ts`:

  ```ts
  describe("detectors — representative locale sweep", () => {
    const cases: Array<{
      locale: string;
      dateFormat: "DD_MM_YYYY" | "MM_DD_YYYY" | "YYYY_MM_DD";
      timeFormat: "H12" | "H24";
      weekStart: "MONDAY" | "SUNDAY" | "SATURDAY";
    }> = [
      {
        locale: "en-US",
        dateFormat: "MM_DD_YYYY",
        timeFormat: "H12",
        weekStart: "SUNDAY",
      },
      {
        locale: "en-CA",
        dateFormat: "YYYY_MM_DD",
        timeFormat: "H12",
        weekStart: "SUNDAY",
      },
      {
        locale: "en-GB",
        dateFormat: "DD_MM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
      },
      {
        locale: "de-DE",
        dateFormat: "DD_MM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
      },
      {
        locale: "ja-JP",
        dateFormat: "YYYY_MM_DD",
        timeFormat: "H24",
        weekStart: "SUNDAY",
      },
      {
        locale: "fr-FR",
        dateFormat: "DD_MM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
      },
    ];

    it.each(cases)(
      "$locale → $dateFormat / $timeFormat / $weekStart",
      ({ locale, dateFormat, timeFormat, weekStart }) => {
        expect(detectDateFormat(locale)).toBe(dateFormat);
        expect(detectTimeFormat(locale)).toBe(timeFormat);
        expect(detectWeekStart(locale)).toBe(weekStart);
      }
    );
  });
  ```

- [ ] **Step 3: Run the full module suite — expect PASS.**

  ```bash
  pnpm webapp:test -- --run app/utils/date-format.test.ts
  ```

  Expected: every §C shape + the locale sweep green. If any §C shape fails, fix the assembly in
  `normalizeOptions`/`formatDate` (NOT the test) until the validated output matches, then re-run.

- [ ] **Step 4: Kill lingering vitest workers (repo hygiene).**

  ```bash
  pkill -f vitest || true
  ```

  Expected: no error (nothing to kill is fine).

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/webapp/app/utils/date-format.test.ts apps/webapp/app/utils/date-format.ts
  git commit -m "test(date-format): lock DateS option-shape + locale detector coverage
  ```

Cover every distinct DateS options shape (facts-02 C1-C10) across two date-format orderings,
plus a representative locale sweep (en-US/en-CA/en-GB/de-DE/ja-JP/fr-FR) for all three
detectors. This freezes the compatibility surface before Phase 3 rewires DateS onto formatDate."

````

---

**End-of-phase check (informational, not a gate):** `pnpm --filter @shelf/webapp typecheck` will
still report errors in `app/components/shared/date.tsx` and
`app/components/workspace/date-format-selector.tsx` — both reference symbols removed here and in
Phase 1. That is expected; Phase 3 (DateS rewrite) and Phase 5 (selector removal) clear them and
restore a green `pnpm webapp:validate`. The Phase 2 gate is the green
`app/utils/date-format.test.ts` suite.

---

## Phase 3: The single-seam plumbing (root loader → requestInfo → hooks → DateS)

This phase wires the resolved formatting prefs through ONE channel. It adds the
server resolution seam (`resolveUserFormatPrefsById`), the fire-and-forget lazy
backfill (`detectAndPersistFormatPrefs`, mirroring `recordMobileActivity`),
resolves `requestInfo.formatPrefs` once per request in the root loader (session
optional), exposes it via `useFormatPrefs()` / `useDateFormatter()`, and rewrites
`DateS` + `formatAbsoluteDate` to consume `formatDate` from the resolved prefs.
It consumes the frozen Phase-2 formatter (`formatDate`, `resolveFormatPrefs`,
`detectFormatPrefsFromHints`, `RawFormatPrefs`, `ResolvedFormatPrefs`,
`DetectedFormatPrefs`, `DateFormatOptions`, `HARDCODED_DEFAULT_PREFS` — all from
`~/utils/date-format`) and the Phase-1 nullable `User` pref columns.

> Depends on Phase 1 (User columns `dateFormat`/`timeFormat`/`weekStart`/`timeZone`
> + enums) and Phase 2 (`app/utils/date-format.ts` rewrite). Do not start Task 3.5
> before Phase 2's `formatDate` exists, and do not run typecheck for 3.1–3.3 until
> Phase 1's `pnpm db:generate` has produced the new Prisma types.

---

### Task 3.1: Server resolution seam — `resolveUserFormatPrefsById`

**Files:**
- Create: `apps/webapp/app/utils/date-format.server.ts`
- Test: `apps/webapp/app/utils/date-format.server.test.ts`

**Interfaces:**
- Consumes: `resolveFormatPrefs(userPrefs, hints)`, `RawFormatPrefs`, `ResolvedFormatPrefs`, `HARDCODED_DEFAULT_PREFS` (from `~/utils/date-format`); `ClientHint` (from `~/utils/client-hints`); `db` (from `~/database/db.server`).
- Produces: `resolveUserFormatPrefsById(userId: string, hints: ClientHint | null, tx?: PrismaTxClient): Promise<ResolvedFormatPrefs>` — the userId-only seam consumed by later export/PDF/email phases and by the root loader's sibling read.

- [ ] **Step 1: Write the failing test.** Create `apps/webapp/app/utils/date-format.server.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: importing date-format.server transitively loads `~/database/db.server`,
// which instantiates a real Prisma client and connects at module load — under
// `pnpm webapp:test` (no DB) that is an unhandled rejection. Mock the module so
// we control the single user read and never open a connection.
const findFirstMock = vi.fn();
vi.mock("~/database/db.server", () => ({
db: { user: { findFirst: findFirstMock } },
}));

import { HARDCODED_DEFAULT_PREFS } from "~/utils/date-format";

import { resolveUserFormatPrefsById } from "./date-format.server";

describe("resolveUserFormatPrefsById", () => {
beforeEach(() => {
  vi.clearAllMocks();
});

it("reads the user's four pref fields and resolves stored values to concrete prefs", async () => {
  findFirstMock.mockResolvedValue({
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStart: "MONDAY",
    timeZone: "Europe/London",
  });

  const prefs = await resolveUserFormatPrefsById("user-1", null);

  // Reads only the four pref columns keyed on the user id.
  expect(findFirstMock).toHaveBeenCalledWith({
    where: { id: "user-1" },
    select: {
      dateFormat: true,
      timeFormat: true,
      weekStart: true,
      timeZone: true,
    },
  });
  // MONDAY → weekStartsOn: 1 (react-day-picker convention).
  expect(prefs).toEqual({
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "Europe/London",
  });
});

it("falls back to hints for still-null fields (pre-existing, not-yet-backfilled user)", async () => {
  findFirstMock.mockResolvedValue({
    dateFormat: null,
    timeFormat: null,
    weekStart: null,
    timeZone: null,
  });

  const prefs = await resolveUserFormatPrefsById("user-1", {
    locale: "en-GB",
    timeZone: "Europe/London",
  });

  // en-GB → day-first + 24h; timezone from the hint.
  expect(prefs.dateFormat).toBe("DD_MM_YYYY");
  expect(prefs.timeFormat).toBe("H24");
  expect(prefs.timeZone).toBe("Europe/London");
});

it("returns the hardcoded default when the user row is missing and no hints", async () => {
  findFirstMock.mockResolvedValue(null);

  const prefs = await resolveUserFormatPrefsById("ghost", null);

  expect(prefs).toEqual(HARDCODED_DEFAULT_PREFS);
});

it("uses the provided tx client instead of db when one is passed", async () => {
  const txFindFirst = vi.fn().mockResolvedValue({
    dateFormat: "YYYY_MM_DD",
    timeFormat: "H12",
    weekStart: "SUNDAY",
    timeZone: "UTC",
  });

  const prefs = await resolveUserFormatPrefsById("user-1", null, {
    user: { findFirst: txFindFirst },
  });

  expect(txFindFirst).toHaveBeenCalledOnce();
  expect(findFirstMock).not.toHaveBeenCalled();
  expect(prefs.dateFormat).toBe("YYYY_MM_DD");
  expect(prefs.weekStartsOn).toBe(0); // SUNDAY → 0
});
});
````

- [ ] **Step 2: Run the test, expect FAIL** (module does not exist yet).

```
pnpm webapp:test -- --run app/utils/date-format.server.test.ts
```

Expected: fails to resolve `./date-format.server`.

- [ ] **Step 3: Implement `date-format.server.ts`.** Create the file:

```ts
/**
 * Server-side date-format resolution seam.
 *
 * Fetches a user's four raw formatting-preference columns and resolves them
 * (against optional request hints) into a fully-concrete {@link ResolvedFormatPrefs}
 * via the same pure resolver the client uses. This is the userId-only entry point
 * for server surfaces that render dates for a specific user — CSV exports and PDFs
 * (acting user) and emails (recipient user) — and is also the sibling of the
 * root loader's inline read.
 *
 * @see {@link file://./date-format.ts} resolveFormatPrefs — the pure resolver
 * @see {@link file://../root.tsx} — root loader resolves the acting user's prefs
 */
import { db } from "~/database/db.server";
import type { ClientHint } from "~/utils/client-hints";
import type { RawFormatPrefs, ResolvedFormatPrefs } from "~/utils/date-format";
import { resolveFormatPrefs } from "~/utils/date-format";

/**
 * Minimal Prisma surface `resolveUserFormatPrefsById` needs. Both the extended
 * top-level client and an interactive transaction client satisfy this shape, so
 * callers can pass either — the same structural-typing approach used by
 * `RecordEventTxClient` (extended-client vs generated-tx are not directly
 * assignable, but both match this narrow shape).
 */
type PrismaTxClient = {
  user: {
    findFirst: (args: {
      where: { id: string };
      select: {
        dateFormat: true;
        timeFormat: true;
        weekStart: true;
        timeZone: true;
      };
    }) => Promise<RawFormatPrefs | null>;
  };
};

/**
 * Fetch a user's raw formatting prefs and resolve them into concrete prefs.
 *
 * In steady state the four columns are concrete (written at user creation), so
 * `hints` is unused; a still-`null` field (pre-existing user not yet lazily
 * backfilled) falls back to `detectFormatPrefsFromHints(hints)` when hints are
 * supplied, else to `HARDCODED_DEFAULT_PREFS`. A missing user row resolves as
 * all-null (→ hints, else defaults).
 *
 * @param userId - The user whose prefs to resolve (acting user for exports/PDFs;
 *   recipient for emails).
 * @param hints - Request browser hints when request-scoped (loaders), else null.
 * @param tx - Optional Prisma transaction client so the read joins a caller's tx.
 * @returns Fully-concrete resolved formatting prefs.
 */
export async function resolveUserFormatPrefsById(
  userId: string,
  hints: ClientHint | null,
  tx?: PrismaTxClient
): Promise<ResolvedFormatPrefs> {
  const client: PrismaTxClient = tx ?? db;

  const userPrefs = await client.user.findFirst({
    where: { id: userId },
    select: {
      dateFormat: true,
      timeFormat: true,
      weekStart: true,
      timeZone: true,
    },
  });

  return resolveFormatPrefs(userPrefs, hints);
}
```

- [ ] **Step 4: Run the test, expect PASS.**

```
pnpm webapp:test -- --run app/utils/date-format.server.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors introduced by the new file.

- [ ] **Step 6: Commit.**

```
git add apps/webapp/app/utils/date-format.server.ts apps/webapp/app/utils/date-format.server.test.ts
git commit -m "feat(webapp): add resolveUserFormatPrefsById server seam

Fetches a user's four raw formatting-pref columns and resolves them to
concrete prefs via the shared resolver. userId-only entry point for the
root loader and later export/PDF/email surfaces; accepts an optional tx."
```

---

### Task 3.2: Lazy backfill — `detectAndPersistFormatPrefs`

**Files:**

- Create: `apps/webapp/app/modules/user/format-prefs.server.ts`
- Test: `apps/webapp/app/modules/user/format-prefs.server.test.ts`

**Interfaces:**

- Consumes: `detectFormatPrefsFromHints(hints)`, `RawFormatPrefs`, `DetectedFormatPrefs` (from `~/utils/date-format`); `ClientHint` (from `~/utils/client-hints`); `db`, `ShelfError`, `Logger`.
- Produces: `detectAndPersistFormatPrefs(userId: string, currentPrefs: RawFormatPrefs, hints: ClientHint): void` — fire-and-forget, null-guarded `updateMany`, called by the root loader.

- [ ] **Step 1: Write the failing test.** Create `apps/webapp/app/modules/user/format-prefs.server.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: importing the module transitively loads `~/database/db.server`, which
// connects at module load. Mock the db module so the fire-and-forget updateMany
// is observable and no real connection opens under `pnpm webapp:test`.
const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
vi.mock("~/database/db.server", () => ({
  db: { user: { updateMany: updateManyMock } },
}));

// why: pin detection so the test asserts the write shape (not Phase-2 detection
// logic, which is covered by date-format.test.ts).
vi.mock("~/utils/date-format", () => ({
  detectFormatPrefsFromHints: vi.fn(() => ({
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStart: "MONDAY",
    timeZone: "Europe/London",
  })),
}));

import { detectAndPersistFormatPrefs } from "./format-prefs.server";

const hints = { locale: "en-GB", timeZone: "Europe/London" };

describe("detectAndPersistFormatPrefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes nothing when every pref is already concrete", () => {
    detectAndPersistFormatPrefs(
      "user-1",
      {
        dateFormat: "MM_DD_YYYY",
        timeFormat: "H12",
        weekStart: "SUNDAY",
        timeZone: "UTC",
      },
      hints
    );

    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("backfills only the still-null fields, guarded by a null-only where clause", () => {
    detectAndPersistFormatPrefs(
      "user-1",
      {
        dateFormat: "MM_DD_YYYY", // already set — must NOT be overwritten
        timeFormat: null,
        weekStart: null,
        timeZone: null,
      },
      hints
    );

    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        OR: [
          { dateFormat: null },
          { timeFormat: null },
          { weekStart: null },
          { timeZone: null },
        ],
      },
      // Only the null fields are written; dateFormat is left untouched.
      data: {
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "Europe/London",
      },
    });
  });

  it("does not throw when the write rejects (fire-and-forget)", async () => {
    updateManyMock.mockRejectedValueOnce(new Error("db down"));

    expect(() =>
      detectAndPersistFormatPrefs(
        "user-1",
        {
          dateFormat: null,
          timeFormat: null,
          weekStart: null,
          timeZone: null,
        },
        hints
      )
    ).not.toThrow();

    // let the swallowed rejection settle without an unhandled rejection
    await Promise.resolve();
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL** (module missing).

```
pnpm webapp:test -- --run app/modules/user/format-prefs.server.test.ts
```

- [ ] **Step 3: Implement `format-prefs.server.ts`.** Create the file:

```ts
/**
 * User formatting-preference lazy backfill.
 *
 * Pre-existing users predate the date/time-formatting feature and have `null`
 * formatting columns. On any authenticated request (the root loader is the
 * chokepoint) we snapshot the browser-hint-detected values into the still-`null`
 * fields, once, fire-and-forget — mirroring the debounced `lastMobileActiveAt`
 * write in `recordMobileActivity`. New users are written concretely at creation
 * (Phase 4) and never reach this path.
 *
 * The write is null-guarded in BOTH directions: only null fields are placed in
 * `data` (a user's explicit choice is never overwritten), and the `updateMany`
 * WHERE clause repeats the null predicate so concurrent requests re-check the
 * committed row under Postgres row locking.
 *
 * @see {@link file://../api/mobile-usage.server.ts} recordMobileActivity — the pattern this mirrors
 * @see {@link file://../../root.tsx} — root loader calls this on null-bearing users
 */
import type { Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ClientHint } from "~/utils/client-hints";
import type { RawFormatPrefs } from "~/utils/date-format";
import { detectFormatPrefsFromHints } from "~/utils/date-format";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/**
 * Detect and persist a pre-existing user's formatting prefs from browser hints,
 * filling only the columns that are still `null`. Fire-and-forget: never awaited,
 * never throws, safe to call on every authenticated request.
 *
 * @param userId - The authenticated (acting) user.
 * @param currentPrefs - The user's four raw pref columns as just read.
 * @param hints - The request's browser hints (locale + timezone).
 * @returns void — best-effort, non-blocking.
 * @throws Never — any failure is caught and logged (uncaptured telemetry).
 */
export function detectAndPersistFormatPrefs(
  userId: string,
  currentPrefs: RawFormatPrefs,
  hints: ClientHint
): void {
  // Fast-path: nothing to backfill if every field is already concrete.
  if (
    currentPrefs.dateFormat !== null &&
    currentPrefs.timeFormat !== null &&
    currentPrefs.weekStart !== null &&
    currentPrefs.timeZone !== null
  ) {
    return;
  }

  const detected = detectFormatPrefsFromHints(hints);

  // Only write the columns that are still null — never clobber a user's choice.
  const data: Prisma.UserUpdateManyMutationInput = {};
  if (currentPrefs.dateFormat === null) data.dateFormat = detected.dateFormat;
  if (currentPrefs.timeFormat === null) data.timeFormat = detected.timeFormat;
  if (currentPrefs.weekStart === null) data.weekStart = detected.weekStart;
  if (currentPrefs.timeZone === null) data.timeZone = detected.timeZone;

  // Fire-and-forget: this must never slow down or break the request it rides on.
  // updateMany (not update) lets us repeat the null-guard in the WHERE clause so
  // Postgres enforces "only the first backfill within a window wins" atomically.
  void db.user
    .updateMany({
      where: {
        id: userId,
        OR: [
          { dateFormat: null },
          { timeFormat: null },
          { weekStart: null },
          { timeZone: null },
        ],
      },
      data,
    })
    .catch((cause) => {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to backfill user format preferences",
          additionalData: { userId },
          label: "User",
          // Best-effort backfill — a failed write must never add Sentry noise;
          // the user simply resolves from live hints until the next load retries.
          shouldBeCaptured: false,
        })
      );
    });
}
```

- [ ] **Step 4: Run the test, expect PASS.**

```
pnpm webapp:test -- --run app/modules/user/format-prefs.server.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. (`Prisma.UserUpdateManyMutationInput` must include the four new enum/string fields — requires Phase 1 `pnpm db:generate` to have run.)

- [ ] **Step 6: Commit.**

```
git add apps/webapp/app/modules/user/format-prefs.server.ts apps/webapp/app/modules/user/format-prefs.server.test.ts
git commit -m "feat(webapp): add lazy format-prefs backfill for existing users

Fire-and-forget null-guarded updateMany mirroring recordMobileActivity:
writes hint-detected values only into still-null pref columns, never
clobbering a user's choice, never blocking or throwing the request."
```

---

### Task 3.3: Root loader — resolve `requestInfo.formatPrefs` + fire backfill

**Files:**

- Modify: `apps/webapp/app/root.tsx:68-84` (loader), imports at `apps/webapp/app/root.tsx:33-38`

**Interfaces:**

- Consumes: `context.getSession()` (throws when no session — `server/index.ts:53`), `getClientHint(request)`, `db`, `resolveFormatPrefs`, `ResolvedFormatPrefs` (from `~/utils/date-format`), `detectAndPersistFormatPrefs` (Task 3.2).
- Produces: `requestInfo.formatPrefs: ResolvedFormatPrefs` on the root loader payload → flows to `useRequestInfo().formatPrefs` (consumed by Task 3.4).

- [ ] **Step 1: Add imports.** In `apps/webapp/app/root.tsx`, after the existing `./database`-adjacent imports, add. Current imports (`root.tsx:33-38`):

```ts
import { ClientHintCheck, getClientHint } from "./utils/client-hints";
import { getBrowserEnv, MAINTENANCE_MODE } from "./utils/env";
import { payload } from "./utils/http.server";
import { useNonce } from "./utils/nonce-provider";
import { isAdmin } from "./utils/roles.server";
import { splashScreenLinks } from "./utils/splash-screen-links";
```

Add these three lines (place `db` import near the top with the other absolute-ish imports, and the date-format imports beside `client-hints`):

```ts
import { db } from "./database/db.server";
import { detectAndPersistFormatPrefs } from "./modules/user/format-prefs.server";
import { resolveFormatPrefs } from "./utils/date-format";
import type { ResolvedFormatPrefs } from "./utils/date-format";
```

- [ ] **Step 2: Rewrite the loader body.** Replace `root.tsx:68-84` (the whole `loader` function) with:

```ts
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  // Super admins bypass maintenance — best-effort. If the admin lookup
  // throws (no session, missing context.getSession, DB error during a
  // migration, etc.), fall through with admin=null so the loader still
  // returns a valid payload. Worst case: admin sees the maintenance
  // screen too. Best case: admin sees the app while users see maintenance.
  const admin = MAINTENANCE_MODE
    ? await isAdmin(context).catch(() => null)
    : null;

  const hints = getClientHint(request);

  // Resolve the acting user's formatting prefs ONCE per request and expose them
  // via requestInfo.formatPrefs — the single seam every date surface reads.
  // Session is optional: context.getSession() throws on auth/onboarding pages
  // (no user), so we tolerate that exactly like the admin lookup above and let
  // browser hints govern (today's behavior). shouldRevalidate=false means this
  // is snapshotted once per full navigation.
  let formatPrefs: ResolvedFormatPrefs;
  try {
    const { userId } = context.getSession();
    const userPrefs = await db.user.findFirst({
      where: { id: userId },
      select: {
        dateFormat: true,
        timeFormat: true,
        weekStart: true,
        timeZone: true,
      },
    });
    formatPrefs = resolveFormatPrefs(userPrefs, hints);

    // Lazy backfill: pre-existing users have null pref columns. Snapshot the
    // hint-detected values once, fire-and-forget (mirrors recordMobileActivity).
    if (
      userPrefs &&
      (userPrefs.dateFormat === null ||
        userPrefs.timeFormat === null ||
        userPrefs.weekStart === null ||
        userPrefs.timeZone === null)
    ) {
      detectAndPersistFormatPrefs(userId, userPrefs, hints);
    }
  } catch {
    // No session / getSession unavailable / transient DB error → hints govern.
    formatPrefs = resolveFormatPrefs(null, hints);
  }

  return payload({
    env: getBrowserEnv(),
    maintenanceMode: MAINTENANCE_MODE && !admin,
    requestInfo: {
      hints,
      formatPrefs,
    },
  });
};
```

- [ ] **Step 3: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. `requestInfo.formatPrefs` is now inferable through `useRequestInfo()`.

- [ ] **Step 4: Manual verification.** With Phase 1 + 2 merged and `pnpm db:generate` run, start the dev server and confirm:

  - `pnpm webapp:dev`, load `/assets` while signed in → dates still render (no crash), and any `NULL` pref columns on your user row get populated after the load (`SELECT "dateFormat","timeZone" FROM "User" WHERE id=...`).
  - Load an unauthenticated page (`/login`) → no 500 from the loader (session-optional catch path); dates fall back to hint-derived formatting.

- [ ] **Step 5: Commit.**

```
git add apps/webapp/app/root.tsx
git commit -m "feat(webapp): resolve requestInfo.formatPrefs in root loader

Reads the acting user's four pref columns (session-optional, catch like
isAdmin), resolves against browser hints, and fires the lazy backfill for
null-bearing users. Exposes formatPrefs alongside hints on requestInfo."
```

---

### Task 3.4: Client hooks — `useFormatPrefs` + `useDateFormatter`

**Files:**

- Create: `apps/webapp/app/hooks/use-format-prefs.ts`
- Create: `apps/webapp/app/hooks/use-date-formatter.ts`

**Interfaces:**

- Consumes: `useRequestInfo()` (from `~/utils/request-info`) → `.formatPrefs: ResolvedFormatPrefs` (produced by Task 3.3); `formatDate`, `DateFormatOptions`, `ResolvedFormatPrefs` (from `~/utils/date-format`).
- Produces: `useFormatPrefs(): ResolvedFormatPrefs`; `useDateFormatter(): { prefs; formatDate; formatTime; formatDateTime }` — consumed by `DateS` (Task 3.5) and the ~50 client sites in later sweep phases.

- [ ] **Step 1: Create `use-format-prefs.ts`.**

```ts
/**
 * Client hook exposing the acting user's fully-resolved formatting preferences.
 *
 * Reads `requestInfo.formatPrefs` — resolved once per request by the ROOT loader
 * (`app/root.tsx`), so this works everywhere, including pre-auth / onboarding
 * pages (unlike layout-scoped hooks such as `useCurrentOrganization`). No
 * prop-drilling: every date surface reads the same resolved prefs.
 *
 * @see {@link file://../root.tsx} — resolves requestInfo.formatPrefs
 * @see {@link file://./use-date-formatter.ts} — bound formatter built on top
 */
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { useRequestInfo } from "~/utils/request-info";

/**
 * @returns the resolved formatting prefs (date/time format, week start, timezone)
 *   for the current request.
 */
export function useFormatPrefs(): ResolvedFormatPrefs {
  return useRequestInfo().formatPrefs;
}
```

- [ ] **Step 2: Create `use-date-formatter.ts`.**

```ts
/**
 * Client hook returning date-formatting functions bound to the acting user's
 * resolved prefs. Thin wrapper over the pure `formatDate` (identical output on
 * server and client) so components never thread prefs manually.
 *
 * The returned object is memoized on `prefs` identity for render stability
 * (root loader data is stable across a navigation), so callers can safely put
 * these functions in dependency arrays.
 *
 * @see {@link file://./use-format-prefs.ts}
 * @see {@link file://../utils/date-format.ts} formatDate — the pure formatter
 */
import { useMemo } from "react";

import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";
import { formatDate as formatDatePure } from "~/utils/date-format";

import { useFormatPrefs } from "./use-format-prefs";

/** The bound formatter surface returned by {@link useDateFormatter}. */
export type BoundDateFormatter = {
  /** The resolved prefs the formatters are bound to. */
  prefs: ResolvedFormatPrefs;
  /** Format a date (date part per prefs; add time via `opts.includeTime`). */
  formatDate: (value: string | Date, opts?: DateFormatOptions) => string;
  /** Format only the time part per the user's time-format pref. */
  formatTime: (value: string | Date, opts?: DateFormatOptions) => string;
  /** Format date + time per the user's prefs. */
  formatDateTime: (value: string | Date, opts?: DateFormatOptions) => string;
};

/**
 * @returns `{ prefs, formatDate, formatTime, formatDateTime }` bound to the
 *   current user's resolved formatting prefs.
 */
export function useDateFormatter(): BoundDateFormatter {
  const prefs = useFormatPrefs();

  return useMemo(
    () => ({
      prefs,
      formatDate: (value: string | Date, opts?: DateFormatOptions) =>
        formatDatePure(value, prefs, opts),
      formatTime: (value: string | Date, opts?: DateFormatOptions) =>
        formatDatePure(value, prefs, { ...opts, onlyTime: true }),
      formatDateTime: (value: string | Date, opts?: DateFormatOptions) =>
        formatDatePure(value, prefs, { ...opts, includeTime: true }),
    }),
    [prefs]
  );
}
```

- [ ] **Step 3: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors (`useRequestInfo().formatPrefs` resolves to `ResolvedFormatPrefs` from Task 3.3's loader return).

- [ ] **Step 4: Commit.**

```
git add apps/webapp/app/hooks/use-format-prefs.ts apps/webapp/app/hooks/use-date-formatter.ts
git commit -m "feat(webapp): add useFormatPrefs and useDateFormatter hooks

Read the root-loader requestInfo.formatPrefs and expose bound
formatDate/formatTime/formatDateTime (memoized on prefs identity).
Available app-wide including pre-auth pages, no prop-drilling."
```

---

### Task 3.5: Rewrite `DateS` + `formatAbsoluteDate` onto the resolved prefs

**Files:**

- Modify: `apps/webapp/app/components/shared/date.tsx` (full rewrite, currently 165 lines)
- Delete: `apps/webapp/app/components/shared/date.test.ts` (tests the removed `formatAbsoluteDate`; its behavior is now covered by Phase 2's `date-format.test.ts` `localeOnly` cases)
- Modify: `apps/webapp/test/routes-tests/locations.$locationId.overview.test.tsx:31-53,151-176` (renders `DateS` — must keep passing under the new plumbing)

**Interfaces:**

- Consumes: `useDateFormatter()` (Task 3.4); `formatDate`, `DateFormatOptions` (from `~/utils/date-format`).
- Produces: `DateS` with the SAME 5 props (`date`, `options`, `includeTime`, `onlyTime`, `localeOnly`) — public API unchanged; internals now prefs-driven. `formatAbsoluteDate` is removed (its no-tz path is `formatDate(..., { localeOnly: true })`).

> Note: all current `DateS` `options` call sites pass only `dateStyle`/`timeStyle`
> or granular `month`/`day`/`year`/`weekday` (verified: `git grep -n "options={{"`),
> every one of which is within `DateFormatOptions`. Retyping the prop from
> `Intl.DateTimeFormatOptions` to `DateFormatOptions` compiles across all sites.

- [ ] **Step 1: Rewrite `date.tsx`.** Replace the ENTIRE file with:

```tsx
/**
 * `DateS` — the single client date-display primitive.
 *
 * Renders a date/time per the acting user's resolved formatting prefs
 * (`useDateFormatter()` → `requestInfo.formatPrefs`), delegating all assembly to
 * the pure `formatDate`. Order/separator, zero-padding, month name-vs-number, and
 * 12/24h all come from the user's prefs — never from the browser locale — so every
 * surface agrees. Timezone conversion is handled inside `formatDate` (skipped when
 * `localeOnly` is set, for absolute dates like working-hours overrides).
 *
 * Always assumes `date` may be a string (loader-serialized) or a `Date`.
 *
 * @see {@link file://../../hooks/use-date-formatter.ts}
 * @see {@link file://../../utils/date-format.ts} formatDate
 */
import { useDateFormatter } from "~/hooks/use-date-formatter";
import type { DateFormatOptions } from "~/utils/date-format";

/**
 * Props for {@link DateS}. `options` is a superset of the Intl option shapes the
 * app passes today; extra branches are handled by `formatDate`.
 */
type DateSProps = {
  /** The value to render. `null` renders nothing (with a dev warning). */
  date: string | Date | null;
  /**
   * Formatting options (weekday/year/month/day/hour/minute or dateStyle/timeStyle).
   * Defaults inside `formatDate` are numeric year/month/day per the user's order.
   */
  options?: DateFormatOptions;
  /** Append the time portion to the date. */
  includeTime?: boolean;
  /** Render only the time portion (no date). */
  onlyTime?: boolean;
  /**
   * Format as an absolute date with NO timezone conversion (use for real-world,
   * location-specific dates like working-hours overrides that must not shift with
   * the viewer's timezone). Still honors the user's order/format prefs.
   */
  localeOnly?: boolean;
};

/**
 * Renders a date/time string using the current user's resolved formatting prefs.
 *
 * @param props - See {@link DateSProps}.
 * @returns A `<span>` with the formatted value, or `null` for a null `date`.
 */
export const DateS = ({
  date,
  options,
  includeTime = false,
  onlyTime = false,
  localeOnly = false,
}: DateSProps) => {
  const { formatDate } = useDateFormatter();

  if (!date) {
    // eslint-disable-next-line no-console
    console.warn("DateS component received null date:", date);
    return null;
  }

  if (localeOnly && includeTime) {
    // eslint-disable-next-line no-console
    console.warn("includeTime is not supported with localeOnly formatting");
  }

  const formattedDate = formatDate(date, {
    ...options,
    includeTime,
    onlyTime,
    localeOnly,
  });

  return <span>{formattedDate}</span>;
};
```

- [ ] **Step 2: Delete the stale unit test.**

```
git rm apps/webapp/app/components/shared/date.test.ts
```

(`formatAbsoluteDate` no longer exists; the `localeOnly` no-tz path is exercised by Phase 2's `app/utils/date-format.test.ts`.)

- [ ] **Step 3: Update the locations-overview test's router + hints stub.** In `apps/webapp/test/routes-tests/locations.$locationId.overview.test.tsx`, replace the `react-router` mock block (`:40-53`) so `useRouteLoaderData("root")` returns a valid `requestInfo` (with concrete `formatPrefs`) — otherwise `useRequestInfo()` dereferences `undefined`:

```ts
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");

  return {
    ...(actual as Record<string, unknown>),
    useLoaderData: vi.fn(),
    // why: DateS now reads the acting user's resolved formatting prefs via
    // useDateFormatter → useRequestInfo → useRouteLoaderData("root"). This
    // component renders in isolation (no data router), so stub the root loader
    // lookup with a concrete requestInfo. Non-"root" ids stay undefined.
    useRouteLoaderData: vi.fn((id: string) =>
      id === "root"
        ? {
            requestInfo: {
              hints: { locale: "en-US", timeZone: "UTC" },
              formatPrefs: {
                dateFormat: "MM_DD_YYYY",
                timeFormat: "H12",
                weekStartsOn: 0,
                timeZone: "UTC",
              },
            },
          }
        : undefined
    ),
  };
});
```

- [ ] **Step 4: Update the component-render assertion.** In the same file, the "renders the overview card" test (`:151-176`) currently asserts the mocked `"formatted-date"`. `DateS` no longer calls the mocked `getDateTimeFormatFromHints`; it formats for real via `formatDate`. Replace the import block and the assertion so the expected string is computed from the real formatter under the stubbed prefs.

Add to the imports at the top of the file:

```ts
import { formatDate } from "~/utils/date-format";
```

Replace the assertion at `:167-168`:

```ts
// DateS component formats the date client-side
expect(screen.getByText("formatted-date")).toBeInTheDocument();
```

with:

```ts
// DateS now formats via the real prefs-bound formatter (no Intl mock).
// Compute the expected string from the same formatter + stubbed prefs.
const expectedDate = formatDate(new Date("2024-01-01T12:34:56Z"), {
  dateFormat: "MM_DD_YYYY",
  timeFormat: "H12",
  weekStartsOn: 0,
  timeZone: "UTC",
});
expect(screen.getByText(expectedDate)).toBeInTheDocument();
```

- [ ] **Step 5: Run the affected tests, expect PASS.**

```
pnpm webapp:test -- --run test/routes-tests/locations.$locationId.overview.test.tsx
```

Expected: both `loader` and `LocationOverview component` tests pass. (The `getClientHint` / `getDateTimeFormatFromHints` client-hints mock at `:33-38` can stay — the loader still uses `getClientHint`; DateS no longer touches those exports.)

- [ ] **Step 6: Typecheck the full webapp.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. If any `DateS` call site fails (an `options` shape outside `DateFormatOptions`), that is a real incompatibility to fix at the call site — none expected per the Step-1 note.

- [ ] **Step 7: Broader verification.** Run the shared-component test folder to catch any other `DateS` renderer that depended on the old plumbing:

```
pnpm webapp:test -- --run app/components/shared
```

Expected: green (no other test imports `formatAbsoluteDate` — verified via `git grep formatAbsoluteDate`).

- [ ] **Step 8: Commit.**

```
git add apps/webapp/app/components/shared/date.tsx apps/webapp/test/routes-tests/locations.$locationId.overview.test.tsx
git rm apps/webapp/app/components/shared/date.test.ts
git commit -m "refactor(webapp): rewrite DateS onto resolved format prefs

DateS now delegates to useDateFormatter/formatDate, dropping the org-locale
hack (resolveDateFormat/mergeDateDisplayOptions/getDateTimeFormatFromHints).
Same 5 props. Removes formatAbsoluteDate (folded into formatDate localeOnly);
updates the locations-overview render test to the new plumbing."
```

---

## Phase 4: Detect format prefs at user creation

Thread the frozen `DetectedFormatPrefs` object down every account-creation path so a
brand-new `User` row is stamped with the browser-detected date/time/week/timezone prefs
at signup. `createUser` stays request-agnostic (it just gains an optional `formatPrefs`
that spreads into `tx.user.create`); each entry action that owns a `request` computes
`detectFormatPrefsFromHints(getClientHint(request))` and threads it down. Detection may
see `timeZone: "UTC"` on the very first request before the `CH-time-zone` cookie round-
trips (facts-01 §5) — acceptable: the resolver falls back and the Phase 3 lazy backfill
corrects it on the next authenticated request. `createUserAccountForTesting` passes
nothing and keeps compiling (fields stay null → resolved at read time).

This phase CONSUMES the Phase 2 contract exports `DetectedFormatPrefs` and
`detectFormatPrefsFromHints` (from `~/utils/date-format`), the existing
`getClientHint` (`~/utils/client-hints`), and the Phase 1 nullable `User` columns
`dateFormat`/`timeFormat`/`weekStart`/`timeZone`. It assumes Phases 1 and 2 are merged
(the Prisma columns exist and `pnpm db:generate` has run so the `@prisma/client` types
carry the new fields and enums).

---

### Task 4.1: Add `formatPrefs` to `createUser` and persist it

**Files:**

- Modify: `apps/webapp/app/modules/user/service.server.ts:649` (payload type), `:662` (destructure), `:683` (create data)
- Test: `apps/webapp/app/modules/user/service.server.test.ts`

**Interfaces:**

- Consumes: `DetectedFormatPrefs` (from `~/utils/date-format`, Phase 2 contract)
- Produces: `createUser(payload & { formatPrefs?: DetectedFormatPrefs })` — the single sink every later task threads into

- [ ] **Step 1: Write the failing persistence test.** Append a new `describe` block to `apps/webapp/app/modules/user/service.server.test.ts`. First extend the existing import from `./service.server` (currently `createUserAccountForTesting, createUserOrAttachOrg, defaultUserCategories`) to also pull in `createUser`:

```ts
import {
  createUser,
  createUserAccountForTesting,
  createUserOrAttachOrg,
  defaultUserCategories,
} from "./service.server";
```

Then add the block after the existing `describe(createUserOrAttachOrg.name, ...)` block (it reuses the module-scope `newUserMock` at test line 304 and the `username` const at line 56):

```ts
describe(createUser.name, () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // @ts-expect-error missing vitest type
    db.user.create.mockResolvedValue(newUserMock);
    // @ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback: any) => callback(db));
  });

  it("persists detected format prefs onto the new user row", async () => {
    // why: DetectedFormatPrefs is the exact shape each entry action passes down
    const formatPrefs = {
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "Europe/Amsterdam",
    } as const;

    await createUser({
      email: USER_EMAIL,
      userId: USER_ID,
      username,
      formatPrefs,
    });

    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dateFormat: "DD_MM_YYYY",
          timeFormat: "H24",
          weekStart: "MONDAY",
          timeZone: "Europe/Amsterdam",
        }),
      })
    );
  });

  it("omits the pref columns when no formatPrefs passed (resolver backfills at read)", async () => {
    await createUser({ email: USER_EMAIL, userId: USER_ID, username });

    // @ts-expect-error missing vitest type
    const createArg = db.user.create.mock.calls[0][0];
    expect(createArg.data.dateFormat).toBeUndefined();
    expect(createArg.data.timeZone).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.**

```
pnpm webapp:test -- --run app/modules/user/service.server.test.ts
```

Expected: the two new `createUser` cases fail — `formatPrefs` is not yet an accepted payload key (TS error) and the columns are never written.

- [ ] **Step 3: Import the type.** In `apps/webapp/app/modules/user/service.server.ts`, add the type import next to the existing `~/utils/*` imports (after the client-hints-free imports, e.g. below line 34 `import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";`):

```ts
import type { DetectedFormatPrefs } from "~/utils/date-format";
```

- [ ] **Step 4: Extend the payload type.** In `createUser` at `service.server.ts:649`, add `formatPrefs` after `createdWithInvite`:

```ts
export async function createUser(
  payload: Pick<
    AuthSession & { username: string },
    "userId" | "email" | "username"
  > & {
    organizationId?: Organization["id"];
    roles?: OrganizationRoles[];
    firstName?: User["firstName"];
    lastName?: User["lastName"];
    isSSO?: boolean;
    createdWithInvite?: boolean;
    /** Browser-detected prefs to stamp on the new row; undefined → resolved at read time. */
    formatPrefs?: DetectedFormatPrefs;
  }
) {
```

- [ ] **Step 5: Destructure it.** In the destructure at `service.server.ts:662`, add `formatPrefs`:

```ts
const {
  email,
  userId,
  username,
  organizationId,
  roles,
  firstName,
  lastName,
  isSSO,
  createdWithInvite,
  formatPrefs,
} = payload;
```

- [ ] **Step 6: Spread into the create data.** In the `tx.user.create({ data: { ... } })` object at `service.server.ts:683`, spread `formatPrefs` right after `createdWithInvite` (a spread of `undefined` adds no keys, so the "omit" test passes):

```ts
        const user = await tx.user.create({
          data: {
            email,
            id: userId,
            username,
            firstName,
            lastName,
            createdWithInvite,
            // Stamp browser-detected date/time/week/timezone prefs when supplied.
            // `{...undefined}` is a no-op, so unset prefs leave the columns null.
            ...formatPrefs,
            roles: {
              connect: {
                name: Roles["USER"],
              },
            },
```

- [ ] **Step 7: Run the test — expect PASS.**

```
pnpm webapp:test -- --run app/modules/user/service.server.test.ts
```

Expected: all `createUser` cases green, existing `createUserOrAttachOrg` / `createUserAccountForTesting` cases still green.

- [ ] **Step 8: Commit.**

```
git add apps/webapp/app/modules/user/service.server.ts apps/webapp/app/modules/user/service.server.test.ts
git commit -m "feat(user): accept detected format prefs on createUser

Add optional formatPrefs (DetectedFormatPrefs) to the createUser payload and
spread it into tx.user.create so a new row is stamped with the browser-detected
date/time/week/timezone prefs. Unset prefs stay null and resolve at read time."
```

---

### Task 4.2: Detect + inject prefs in the OTP signup action

**Files:**

- Modify: `apps/webapp/app/routes/_auth+/otp.tsx:20` (imports), `:95` (createUser call)
- Test: `apps/webapp/app/routes/_auth+/otp.test.ts` (Create)

**Interfaces:**

- Consumes: `createUser` payload from Task 4.1; `detectFormatPrefsFromHints` + `getClientHint`
- Produces: none downstream (leaf entry action)

- [ ] **Step 1: Write the failing wiring test.** Create `apps/webapp/app/routes/_auth+/otp.test.ts`. It mocks the auth/user/org deps so the action reaches the `createUser` branch, stubs `detectFormatPrefsFromHints` with a sentinel, and asserts the sentinel reaches `createUser`:

```ts
import { USER_EMAIL, USER_ID, ORGANIZATION_ID } from "@mocks/user";

import { verifyOtpAndSignin } from "~/modules/auth/service.server";
import {
  getSelectedOrganization,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import { createUser, findUserByEmail } from "~/modules/user/service.server";
import { generateUniqueUsername } from "~/modules/user/utils.server";
import { detectFormatPrefsFromHints } from "~/utils/date-format";

import { action } from "./otp";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: exercise the OTP signup action without hitting Supabase/Prisma; we only
// assert the format-pref detection is wired into the createUser call.
vitest.mock("~/modules/auth/service.server", () => ({
  verifyOtpAndSignin: vitest.fn(),
}));
vitest.mock("~/modules/user/service.server", () => ({
  createUser: vitest.fn(),
  findUserByEmail: vitest.fn(),
}));
vitest.mock("~/modules/user/utils.server", () => ({
  generateUniqueUsername: vitest.fn(),
}));
vitest.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vitest.fn(),
  setSelectedOrganizationIdCookie: vitest.fn(),
}));
// why: keep the pure detector real elsewhere but pin its output so the assertion
// is deterministic regardless of the host ICU/locale data.
vitest.mock("~/utils/date-format", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, detectFormatPrefsFromHints: vitest.fn() };
});

const username = `test-user-${USER_ID}`;
const DETECTED = {
  dateFormat: "YYYY_MM_DD",
  timeFormat: "H24",
  weekStart: "MONDAY",
  timeZone: "Asia/Tokyo",
} as const;

describe("otp action — format pref detection", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // @ts-expect-error missing vitest type
    verifyOtpAndSignin.mockResolvedValue({
      userId: USER_ID,
      email: USER_EMAIL,
    });
    // @ts-expect-error missing vitest type — user does not exist yet → signup branch
    findUserByEmail.mockResolvedValue(null);
    // @ts-expect-error missing vitest type
    generateUniqueUsername.mockResolvedValue(username);
    // @ts-expect-error missing vitest type
    createUser.mockResolvedValue({ id: USER_ID });
    // @ts-expect-error missing vitest type
    getSelectedOrganization.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
    });
    // @ts-expect-error missing vitest type
    setSelectedOrganizationIdCookie.mockResolvedValue("org-cookie");
    // @ts-expect-error missing vitest type
    detectFormatPrefsFromHints.mockReturnValue(DETECTED);
  });

  it("detects prefs from the request and passes them to createUser on signup", async () => {
    const formData = new FormData();
    formData.append("email", USER_EMAIL);
    formData.append("otp", "123456");

    const request = new Request("http://localhost/otp", {
      method: "POST",
      headers: { "accept-language": "ja-JP" },
      body: formData,
    });
    const context = { isAuthenticated: false, setSession: vitest.fn() };

    await action({ request, context, params: {} } as any);

    expect(detectFormatPrefsFromHints).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ formatPrefs: DETECTED })
    );
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.**

```
pnpm webapp:test -- --run app/routes/_auth+/otp.test.ts
```

Expected: fails — the action does not call `detectFormatPrefsFromHints` and `createUser` is called with no `formatPrefs`.

- [ ] **Step 3: Add the imports.** In `apps/webapp/app/routes/_auth+/otp.tsx`, add (grouped with the other `~/utils` imports, e.g. after line 23 `import { setCookie } from "~/utils/cookies.server";`):

```ts
import { getClientHint } from "~/utils/client-hints";
import { detectFormatPrefsFromHints } from "~/utils/date-format";
```

- [ ] **Step 4: Detect + pass in the signup branch.** In the action at `otp.tsx:95`, replace the `createUser` call (inside `if (!userExists) { try { ... } }`):

```ts
        if (!userExists) {
          try {
            const username = await generateUniqueUsername(authSession.email);
            // Detect the caller's date/time/week/timezone prefs from browser
            // hints (accept-language + CH-time-zone cookie) and stamp them on
            // the new row. First-request timeZone may fall back to "UTC" before
            // the hint cookie round-trips — the lazy backfill corrects it later.
            const formatPrefs = detectFormatPrefsFromHints(
              getClientHint(request)
            );
            await createUser({
              ...authSession,
              username,
              formatPrefs,
            });
          } catch (createError) {
```

- [ ] **Step 5: Run the test — expect PASS.**

```
pnpm webapp:test -- --run app/routes/_auth+/otp.test.ts
```

Expected: green — `detectFormatPrefsFromHints` invoked once and its result reaches `createUser`.

- [ ] **Step 6: Commit.**

```
git add apps/webapp/app/routes/_auth+/otp.tsx apps/webapp/app/routes/_auth+/otp.test.ts
git commit -m "feat(auth): detect format prefs on OTP signup

Compute detectFormatPrefsFromHints(getClientHint(request)) in the OTP action and
pass it into createUser so self-serve signups get their date/time/week/timezone
prefs stamped at creation."
```

---

### Task 4.3: Thread prefs through the invite-accept path

**Files:**

- Modify: `apps/webapp/app/modules/user/service.server.ts:223` (`createUserOrAttachOrg` param), `:270` (createUser call)
- Modify: `apps/webapp/app/modules/invite/service.server.ts:314` (`updateInviteStatus` param), `:368` (`createUserOrAttachOrg` call)
- Modify: `apps/webapp/app/routes/_auth+/accept-invite.$inviteId.tsx:100` (action), `:115` (`updateInviteStatus` call)

**Interfaces:**

- Consumes: `createUser` payload from Task 4.1; `DetectedFormatPrefs`; `detectFormatPrefsFromHints` + `getClientHint`
- Produces: `createUserOrAttachOrg({ ..., formatPrefs? })` and `updateInviteStatus({ ..., formatPrefs? })` optional params

- [ ] **Step 1: Add `formatPrefs` to `createUserOrAttachOrg`.** In `service.server.ts:223`, extend the destructure + intersection type (`DetectedFormatPrefs` is already imported from Task 4.1 Step 3):

```ts
export async function createUserOrAttachOrg({
  email,
  organizationId,
  roles,
  password,
  firstName,
  lastName,
  createdWithInvite = false,
  formatPrefs,
}: Pick<User, "email" | "firstName"> &
  Partial<Pick<User, "lastName">> & {
    organizationId: Organization["id"];
    roles: OrganizationRoles[];
    password: string;
    createdWithInvite: boolean;
    /** Browser-detected prefs threaded down from the invite-accept action. */
    formatPrefs?: DetectedFormatPrefs;
  }) {
```

- [ ] **Step 2: Forward it to `createUser`.** In the same function at `service.server.ts:270`, add `formatPrefs` to the `createUser` call:

```ts
const newUser = await createUser({
  email,
  userId: authAccount.id,
  username: randomUsernameFromEmail(email),
  organizationId,
  roles,
  firstName,
  lastName,
  createdWithInvite,
  formatPrefs,
});
```

- [ ] **Step 3: Import the type in the invite service.** In `apps/webapp/app/modules/invite/service.server.ts`, add near the existing imports (top of file, with the other `~/utils`/type imports):

```ts
import type { DetectedFormatPrefs } from "~/utils/date-format";
```

- [ ] **Step 4: Add `formatPrefs` to `updateInviteStatus` and forward it.** In `invite/service.server.ts:314`, extend the param, then forward it in the `createUserOrAttachOrg` call at `:368`:

```ts
export async function updateInviteStatus({
  id,
  status,
  password,
  formatPrefs,
}: Pick<Invite, "id" | "status"> & {
  password: string;
  /** Browser-detected prefs from the accept-invite action; stamped on new users. */
  formatPrefs?: DetectedFormatPrefs;
}) {
```

and at `:368`:

```ts
const user = await createUserOrAttachOrg({
  email: invite.inviteeEmail,
  organizationId: invite.organizationId,
  roles: invite.roles,
  password,
  firstName,
  lastName,
  createdWithInvite: true,
  formatPrefs,
});
```

- [ ] **Step 5: Detect + pass in the accept-invite action.** In `apps/webapp/app/routes/_auth+/accept-invite.$inviteId.tsx`, add the imports (with the other `~/utils` imports, after line 23 `import { setCookie } from "~/utils/cookies.server";`):

```ts
import { getClientHint } from "~/utils/client-hints";
import { detectFormatPrefsFromHints } from "~/utils/date-format";
```

then in the action at `:115` compute and pass `formatPrefs`:

```ts
const password = generateRandomCode(10);
// Detect the accepter's prefs from browser hints so their brand-new user
// row is stamped at creation (lazy backfill corrects any UTC fallback).
const formatPrefs = detectFormatPrefsFromHints(getClientHint(request));
const updatedInvite = await updateInviteStatus({
  id: decodedInvite.id,
  status: InviteStatuses.ACCEPTED,
  password,
  formatPrefs,
});
```

- [ ] **Step 6: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: clean — the new optional param flows through all three hops with no errors.

- [ ] **Step 7: Manual verification (note for reviewer).** Accept a fresh invite in a browser whose language/timezone differ from the server default (e.g. `en-GB`, `Europe/London`); after landing in `/assets`, confirm the new `User` row has `dateFormat = DD_MM_YYYY`, `timeFormat = H24`, `weekStart = MONDAY`, `timeZone = Europe/London` (or `UTC` if the `CH-time-zone` cookie had not yet round-tripped — expected, backfilled on next load).

- [ ] **Step 8: Commit.**

```
git add apps/webapp/app/modules/user/service.server.ts apps/webapp/app/modules/invite/service.server.ts apps/webapp/app/routes/_auth+/accept-invite.\$inviteId.tsx
git commit -m "feat(invite): detect format prefs on invite accept

Thread DetectedFormatPrefs from the accept-invite action through updateInviteStatus
and createUserOrAttachOrg into createUser so invited users get their date/time/week/
timezone prefs stamped at creation."
```

---

### Task 4.4: Thread prefs through both SSO callbacks

**Files:**

- Modify: `apps/webapp/app/modules/user/service.server.ts:336` (`createUserFromSSO` signature), `:358` (createUser call)
- Modify: `apps/webapp/app/utils/sso.server.ts:45` (`resolveUserAndOrgForSsoCallback` param), `:100` (`createUserFromSSO` call)
- Modify: `apps/webapp/app/routes/_auth+/oauth.callback.tsx:120` (web action), `apps/webapp/app/routes/_auth+/oauth.callback_.mobile.tsx:135` (mobile action)

**Interfaces:**

- Consumes: `createUser` payload from Task 4.1; `DetectedFormatPrefs`; `detectFormatPrefsFromHints` + `getClientHint`
- Produces: `createUserFromSSO(authSession, userData, formatPrefs?)` and `resolveUserAndOrgForSsoCallback({ ..., formatPrefs? })` optional params

- [ ] **Step 1: Add a `formatPrefs` param to `createUserFromSSO`.** In `service.server.ts:336`, add a third optional parameter (`DetectedFormatPrefs` already imported in Task 4.1) and forward it to `createUser` at `:358`:

```ts
export async function createUserFromSSO(
  authSession: AuthSession,
  userData: {
    firstName: string;
    lastName: string;
    groups: string[];
    contactInfo?: {
      phone?: string;
      street?: string;
      city?: string;
      stateProvince?: string;
      zipPostalCode?: string;
      countryRegion?: string;
    };
  },
  /** Browser-detected prefs from the SSO callback action; stamped on the new row. */
  formatPrefs?: DetectedFormatPrefs
) {
```

and at `:358`:

```ts
// Create user with personal workspace
const user = await createUser({
  email,
  firstName,
  lastName,
  userId,
  username: randomUsernameFromEmail(email),
  isSSO: true,
  formatPrefs,
});
```

- [ ] **Step 2: Import the type in the SSO util.** In `apps/webapp/app/utils/sso.server.ts`, add with the existing local imports (after line 18 `import { isLikeShelfError, ShelfError } from "./error";`):

```ts
import type { DetectedFormatPrefs } from "./date-format";
```

- [ ] **Step 3: Add `formatPrefs` to `resolveUserAndOrgForSsoCallback` and forward it.** In `sso.server.ts:45`, extend the destructure + param type:

```ts
export async function resolveUserAndOrgForSsoCallback({
  authSession,
  firstName,
  lastName,
  groups,
  contactInfo,
  formatPrefs,
}: {
  authSession: AuthSession;
  firstName: string;
  lastName: string;
  groups: string[];
  contactInfo?: {
    phone?: string;
    street?: string;
    city?: string;
    stateProvince?: string;
    zipPostalCode?: string;
    countryRegion?: string;
  };
  /** Browser-detected prefs; only applied on the new-user (createUserFromSSO) branch. */
  formatPrefs?: DetectedFormatPrefs;
}) {
```

then pass it into the new-user branch at `:100` (leave the existing-user `updateUserFromSSO` branch untouched — backfill handles those):

```ts
    // New user case - create them with SSO
    try {
      const response = await createUserFromSSO(
        authSession,
        {
          firstName,
          lastName,
          groups,
          contactInfo,
        },
        formatPrefs
      );
      return { user: response.user, org: response.org };
```

- [ ] **Step 4: Detect + pass in the WEB oauth callback.** In `apps/webapp/app/routes/_auth+/oauth.callback.tsx`, add the imports (with the other `~/utils`/service imports, near line 29 `import { resolveUserAndOrgForSsoCallback } from "~/utils/sso.server";`):

```ts
import { getClientHint } from "~/utils/client-hints";
import { detectFormatPrefsFromHints } from "~/utils/date-format";
```

then at `:120` compute and pass `formatPrefs`:

```ts
// Detect the caller's date/time/week/timezone prefs from browser hints;
// only the new-user branch of the resolver consumes them.
const formatPrefs = detectFormatPrefsFromHints(getClientHint(request));
const { org } = await resolveUserAndOrgForSsoCallback({
  authSession,
  firstName,
  lastName,
  groups,
  contactInfo,
  formatPrefs,
});
```

- [ ] **Step 5: Detect + pass in the MOBILE oauth callback.** In `apps/webapp/app/routes/_auth+/oauth.callback_.mobile.tsx`, add the same imports (near line 23 `import { resolveUserAndOrgForSsoCallback } from "~/utils/sso.server";`):

```ts
import { getClientHint } from "~/utils/client-hints";
import { detectFormatPrefsFromHints } from "~/utils/date-format";
```

then at `:135` compute and pass `formatPrefs`:

```ts
// Same detection as the web callback; the mobile Request still carries
// accept-language + the CH-time-zone cookie for getClientHint.
const formatPrefs = detectFormatPrefsFromHints(getClientHint(request));
await resolveUserAndOrgForSsoCallback({
  authSession,
  firstName,
  lastName,
  groups,
  contactInfo,
  formatPrefs,
});
```

- [ ] **Step 6: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: clean — the optional third arg and the new object key resolve on both call sites; existing callers that omit `formatPrefs` still compile.

- [ ] **Step 7: Manual verification (note for reviewer).** Complete a first-time SSO login (web) from a browser with a non-default locale/timezone; confirm the newly-provisioned `User` row carries the detected prefs (or `UTC`/defaults if the hint cookie had not round-tripped — expected, backfilled next load). Existing SSO users take the `updateUserFromSSO` branch and are intentionally left to the lazy backfill.

- [ ] **Step 8: Commit.**

```
git add apps/webapp/app/modules/user/service.server.ts apps/webapp/app/utils/sso.server.ts apps/webapp/app/routes/_auth+/oauth.callback.tsx apps/webapp/app/routes/_auth+/oauth.callback_.mobile.tsx
git commit -m "feat(sso): detect format prefs on SSO signup

Thread DetectedFormatPrefs from both the web and mobile oauth callbacks through
resolveUserAndOrgForSsoCallback and createUserFromSSO into createUser so new SSO
users get their date/time/week/timezone prefs stamped at creation."
```

---

### Phase 4 exit check

- [ ] **Full validate.**

```
pnpm webapp:validate
```

Expected: prisma generate, lint, prettier, typecheck and the full Vitest suite (including the new `service.server` and `otp` tests) all pass. Kill any lingering Vitest watcher afterward.

---

## Phase 5: Account "Language & region" settings

This phase gives users a self-service card on the General account tab to set their four
formatting preferences (`dateFormat`, `timeFormat`, `weekStart`, `timeZone`). It extends the
persistence layer (`UpdateUserPayload` → `updateUser`), builds four Popover-based selector
components under `app/components/user/language-region/`, assembles them into a
`LanguageRegionForm` Card with a live "Dates will look like…" preview driven by the new pure
`formatDate(new Date(), livePrefs)`, and wires a new `updateFormatPrefs` action intent into
`account-details.general.tsx`. Values are always **concrete** — there is no "Automatic" option;
a `null` DB field simply defaults its selector to the hint-detected value via `useFormatPrefs()`.

Depends on: Phase 1 (Prisma enums + nullable User columns), Phase 2 (`formatDate`,
`ResolvedFormatPrefs`, `DateFormatPreference`/`TimeFormatPreference`/`WeekStartPreference`),
Phase 3 (`useFormatPrefs()`).

---

### Task 5.1: Extend `UpdateUserPayload` with the four format-preference fields

**Files:** (Modify: `app/modules/user/types.ts:3-15`)
**Interfaces:** (Consumes: Prisma `User["dateFormat"] | ["timeFormat"] | ["weekStart"] | ["timeZone"]` from Phase 1 / Produces: `UpdateUserPayload` with `dateFormat?`, `timeFormat?`, `weekStart?`, `timeZone?` — consumed by Task 5.5's action case and by `updateUser`)

- [ ] **Step 1: Add the four optional fields to `UpdateUserPayload`.**

  In `app/modules/user/types.ts`, replace the current interface (lines 3-15):

  ```ts
  export interface UpdateUserPayload {
    id: User["id"];
    username?: User["username"];
    email?: User["email"];
    firstName?: User["firstName"];
    lastName?: User["lastName"];
    displayName?: User["displayName"];
    profilePicture?: User["profilePicture"];
    onboarded?: User["onboarded"];
    password?: string;
    confirmPassword?: string;
    usedFreeTrial?: boolean;
  }
  ```

  with:

  ```ts
  export interface UpdateUserPayload {
    id: User["id"];
    username?: User["username"];
    email?: User["email"];
    firstName?: User["firstName"];
    lastName?: User["lastName"];
    displayName?: User["displayName"];
    profilePicture?: User["profilePicture"];
    onboarded?: User["onboarded"];
    password?: string;
    confirmPassword?: string;
    usedFreeTrial?: boolean;
    /** User's chosen short-date field order; null → not yet detected. */
    dateFormat?: User["dateFormat"];
    /** 12- vs 24-hour clock; null → not yet detected. */
    timeFormat?: User["timeFormat"];
    /** First day of the week for calendars; null → not yet detected. */
    weekStart?: User["weekStart"];
    /** IANA time-zone name; null → not yet detected. */
    timeZone?: User["timeZone"];
  }
  ```

  No change is needed in `updateUser` (`service.server.ts:811`): it spreads `cleanClone`
  (the payload minus `password`/`confirmPassword`/`email`) straight into
  `db.user.update({ data })`, so the four new fields flow through automatically. Likewise
  `getUserWithContact` (`service.server.ts:120`) uses `include` (not `select`), so Prisma
  already returns every scalar column — the new fields reach the form with no query change.

- [ ] **Step 2: Typecheck.**

  Run: `pnpm --filter @shelf/webapp typecheck`
  Expected: passes. `User["dateFormat"]` etc. resolve to the nullable Phase-1 enum/string types.

- [ ] **Step 3: Commit.**

  ```bash
  git add app/modules/user/types.ts
  git commit -m "feat(user): add format-preference fields to UpdateUserPayload

  dateFormat/timeFormat/weekStart/timeZone now flow through updateUser so the
  account settings card can persist them. getUserWithContact returns them for
  free (include-based select)."
  ```

---

### Task 5.2: Build the three small-enum selectors (`DateFormatSelect`, `TimeFormatSelect`, `WeekStartSelect`)

**Files:** (Create: `app/components/user/language-region/date-format-select.tsx`, `app/components/user/language-region/time-format-select.tsx`, `app/components/user/language-region/week-start-select.tsx`; Test: `app/components/user/language-region/date-format-select.test.tsx`)
**Interfaces:** (Consumes: `DateFormatPreference`/`TimeFormatPreference`/`WeekStartPreference` from `@prisma/client` / Produces: three controlled selector components `{ name; value; onChange; className? }`, each rendering a hidden `<input name value>` — consumed by Task 5.4's `LanguageRegionForm`)

These clone the small-enum Popover pattern from the to-be-removed
`app/components/workspace/date-format-selector.tsx` (trigger `<button type="button">`,
`<PopoverContent role="listbox">`, `OPTIONS` array, `handleActivationKeyPress`, hidden input),
but are **controlled** (`value` + `onChange`) so the parent form can drive the live preview.

- [ ] **Step 1: Write a failing render test for `DateFormatSelect`.**

  Create `app/components/user/language-region/date-format-select.test.tsx`:

  ```tsx
  /**
   * DateFormatSelect — unit tests
   *
   * Verifies the controlled small-enum selector renders the label for its
   * current `value` and submits that value through the hidden input named by
   * `name`, so it rides the surrounding LanguageRegionForm.
   *
   * @see {@link file://./date-format-select.tsx}
   */
  import { render, screen } from "@testing-library/react";
  import { describe, it, expect, vi } from "vitest";
  import { DateFormatSelect } from "./date-format-select";

  describe("DateFormatSelect", () => {
    it("renders the label for the current value", () => {
      render(
        <DateFormatSelect
          name="dateFormat"
          value="YYYY_MM_DD"
          onChange={vi.fn()}
        />
      );
      expect(screen.getByText("Year / Month / Day")).toBeTruthy();
    });

    it("submits the current value via a hidden input", () => {
      const { container } = render(
        <DateFormatSelect
          name="dateFormat"
          value="DD_MM_YYYY"
          onChange={vi.fn()}
        />
      );
      const hidden = container.querySelector<HTMLInputElement>(
        'input[type="hidden"][name="dateFormat"]'
      );
      expect(hidden?.value).toBe("DD_MM_YYYY");
    });
  });
  ```

  Run: `pnpm webapp:test -- --run app/components/user/language-region/date-format-select.test.tsx`
  Expected: FAIL (module `./date-format-select` does not exist yet).

- [ ] **Step 2: Implement `DateFormatSelect`.**

  Create `app/components/user/language-region/date-format-select.tsx`:

  ```tsx
  /**
   * DateFormatSelect
   *
   * Controlled small-enum Popover selector for a user's short-date field order
   * ({@link DateFormatPreference}). Mirrors the workspace date-format selector's
   * listbox pattern, but is controlled (`value` + `onChange`) so the parent
   * LanguageRegionForm can drive its live "Dates will look like…" preview. The
   * chosen value rides the surrounding form via a hidden input named `name`.
   *
   * @see {@link file://./language-region-form.tsx}
   */
  import { useRef, useState } from "react";

  import type { DateFormatPreference } from "@prisma/client";
  import {
    Popover,
    PopoverContent,
    PopoverPortal,
    PopoverTrigger,
  } from "@radix-ui/react-popover";
  import { CheckIcon, ChevronDownIcon } from "lucide-react";
  import { handleActivationKeyPress } from "~/utils/keyboard";
  import { tw } from "~/utils/tw";
  import When from "~/components/when/when";

  /** One selectable date-format option. */
  type Option = {
    value: DateFormatPreference;
    label: string;
    description: string;
  };

  const OPTIONS: Option[] = [
    {
      value: "DD_MM_YYYY",
      label: "Day / Month / Year",
      description: "e.g. 03/04/2026",
    },
    {
      value: "MM_DD_YYYY",
      label: "Month / Day / Year",
      description: "e.g. 04/03/2026",
    },
    {
      value: "YYYY_MM_DD",
      label: "Year / Month / Day",
      description: "e.g. 2026-04-03",
    },
  ];

  /** Props for the controlled date-format selector. */
  type DateFormatSelectProps = {
    /** Name of the hidden input the value is submitted under. */
    name: string;
    /** Current concrete date-format preference. */
    value: DateFormatPreference;
    /** Called with the newly-chosen value. */
    onChange: (value: DateFormatPreference) => void;
    /** Optional class applied to the trigger button. */
    className?: string;
  };

  /**
   * Controlled date-format dropdown.
   *
   * @param props.name - Hidden-input name for form submission
   * @param props.value - Current concrete date-format preference
   * @param props.onChange - Selection callback
   * @param props.className - Optional trigger class
   * @returns The date-format selector control
   */
  export function DateFormatSelect({
    name,
    value,
    onChange,
    className,
  }: DateFormatSelectProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [isOpen, setIsOpen] = useState(false);

    const selectedOption =
      OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

    function handleSelect(next: DateFormatPreference) {
      onChange(next);
      setIsOpen(false);
    }

    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            // type="button" required by local-rules/require-button-type — the
            // trigger sits inside the LanguageRegionForm <Form>, so the native
            // "submit" default would submit on open.
            type="button"
            className={tw(
              "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left",
              className
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-gray-900">
                {selectedOption.label}
              </span>
              <span className="truncate text-xs text-gray-500">
                {selectedOption.description}
              </span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-gray-500" />
            <input type="hidden" name={name} value={selectedOption.value} />
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            className="z-[999999] max-h-[400px] overflow-scroll rounded-md border bg-white"
            side="bottom"
            style={{ width: triggerRef?.current?.clientWidth }}
            role="listbox"
            aria-label="Date format options"
          >
            {OPTIONS.map((option) => {
              const isSelected = selectedOption.value === option.value;
              return (
                <div
                  key={option.value}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:cursor-pointer hover:bg-gray-50"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => handleSelect(option.value)}
                  onKeyDown={handleActivationKeyPress(() =>
                    handleSelect(option.value)
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {option.label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {option.description}
                    </span>
                  </div>
                  <When truthy={isSelected}>
                    <CheckIcon className="size-4 shrink-0 text-primary" />
                  </When>
                </div>
              );
            })}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    );
  }
  ```

  Run: `pnpm webapp:test -- --run app/components/user/language-region/date-format-select.test.tsx`
  Expected: PASS (2 tests).

- [ ] **Step 3: Implement `TimeFormatSelect` (same pattern, H12/H24 options).**

  Create `app/components/user/language-region/time-format-select.tsx`:

  ```tsx
  /**
   * TimeFormatSelect
   *
   * Controlled small-enum Popover selector for the 12- vs 24-hour clock
   * ({@link TimeFormatPreference}). Same listbox pattern as DateFormatSelect;
   * value rides the surrounding form via a hidden input named `name`.
   *
   * @see {@link file://./language-region-form.tsx}
   */
  import { useRef, useState } from "react";

  import type { TimeFormatPreference } from "@prisma/client";
  import {
    Popover,
    PopoverContent,
    PopoverPortal,
    PopoverTrigger,
  } from "@radix-ui/react-popover";
  import { CheckIcon, ChevronDownIcon } from "lucide-react";
  import { handleActivationKeyPress } from "~/utils/keyboard";
  import { tw } from "~/utils/tw";
  import When from "~/components/when/when";

  /** One selectable time-format option. */
  type Option = {
    value: TimeFormatPreference;
    label: string;
    description: string;
  };

  const OPTIONS: Option[] = [
    { value: "H12", label: "12-hour", description: "e.g. 2:30 PM" },
    { value: "H24", label: "24-hour", description: "e.g. 14:30" },
  ];

  /** Props for the controlled time-format selector. */
  type TimeFormatSelectProps = {
    /** Name of the hidden input the value is submitted under. */
    name: string;
    /** Current concrete time-format preference. */
    value: TimeFormatPreference;
    /** Called with the newly-chosen value. */
    onChange: (value: TimeFormatPreference) => void;
    /** Optional class applied to the trigger button. */
    className?: string;
  };

  /**
   * Controlled time-format dropdown.
   *
   * @param props.name - Hidden-input name for form submission
   * @param props.value - Current concrete time-format preference
   * @param props.onChange - Selection callback
   * @param props.className - Optional trigger class
   * @returns The time-format selector control
   */
  export function TimeFormatSelect({
    name,
    value,
    onChange,
    className,
  }: TimeFormatSelectProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [isOpen, setIsOpen] = useState(false);

    const selectedOption =
      OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

    function handleSelect(next: TimeFormatPreference) {
      onChange(next);
      setIsOpen(false);
    }

    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            // type="button" required by local-rules/require-button-type.
            type="button"
            className={tw(
              "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left",
              className
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-gray-900">
                {selectedOption.label}
              </span>
              <span className="truncate text-xs text-gray-500">
                {selectedOption.description}
              </span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-gray-500" />
            <input type="hidden" name={name} value={selectedOption.value} />
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            className="z-[999999] max-h-[400px] overflow-scroll rounded-md border bg-white"
            side="bottom"
            style={{ width: triggerRef?.current?.clientWidth }}
            role="listbox"
            aria-label="Time format options"
          >
            {OPTIONS.map((option) => {
              const isSelected = selectedOption.value === option.value;
              return (
                <div
                  key={option.value}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:cursor-pointer hover:bg-gray-50"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => handleSelect(option.value)}
                  onKeyDown={handleActivationKeyPress(() =>
                    handleSelect(option.value)
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {option.label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {option.description}
                    </span>
                  </div>
                  <When truthy={isSelected}>
                    <CheckIcon className="size-4 shrink-0 text-primary" />
                  </When>
                </div>
              );
            })}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    );
  }
  ```

- [ ] **Step 4: Implement `WeekStartSelect` (same pattern, MONDAY/SUNDAY/SATURDAY options).**

  Create `app/components/user/language-region/week-start-select.tsx`:

  ```tsx
  /**
   * WeekStartSelect
   *
   * Controlled small-enum Popover selector for the first day of the week
   * ({@link WeekStartPreference}). Same listbox pattern as DateFormatSelect;
   * value rides the surrounding form via a hidden input named `name`.
   *
   * @see {@link file://./language-region-form.tsx}
   */
  import { useRef, useState } from "react";

  import type { WeekStartPreference } from "@prisma/client";
  import {
    Popover,
    PopoverContent,
    PopoverPortal,
    PopoverTrigger,
  } from "@radix-ui/react-popover";
  import { CheckIcon, ChevronDownIcon } from "lucide-react";
  import { handleActivationKeyPress } from "~/utils/keyboard";
  import { tw } from "~/utils/tw";
  import When from "~/components/when/when";

  /** One selectable week-start option. */
  type Option = {
    value: WeekStartPreference;
    label: string;
    description: string;
  };

  const OPTIONS: Option[] = [
    {
      value: "MONDAY",
      label: "Monday",
      description: "Weeks start on Monday",
    },
    {
      value: "SUNDAY",
      label: "Sunday",
      description: "Weeks start on Sunday",
    },
    {
      value: "SATURDAY",
      label: "Saturday",
      description: "Weeks start on Saturday",
    },
  ];

  /** Props for the controlled week-start selector. */
  type WeekStartSelectProps = {
    /** Name of the hidden input the value is submitted under. */
    name: string;
    /** Current concrete week-start preference. */
    value: WeekStartPreference;
    /** Called with the newly-chosen value. */
    onChange: (value: WeekStartPreference) => void;
    /** Optional class applied to the trigger button. */
    className?: string;
  };

  /**
   * Controlled week-start dropdown.
   *
   * @param props.name - Hidden-input name for form submission
   * @param props.value - Current concrete week-start preference
   * @param props.onChange - Selection callback
   * @param props.className - Optional trigger class
   * @returns The week-start selector control
   */
  export function WeekStartSelect({
    name,
    value,
    onChange,
    className,
  }: WeekStartSelectProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [isOpen, setIsOpen] = useState(false);

    const selectedOption =
      OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

    function handleSelect(next: WeekStartPreference) {
      onChange(next);
      setIsOpen(false);
    }

    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            // type="button" required by local-rules/require-button-type.
            type="button"
            className={tw(
              "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left",
              className
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-gray-900">
                {selectedOption.label}
              </span>
              <span className="truncate text-xs text-gray-500">
                {selectedOption.description}
              </span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-gray-500" />
            <input type="hidden" name={name} value={selectedOption.value} />
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            className="z-[999999] max-h-[400px] overflow-scroll rounded-md border bg-white"
            side="bottom"
            style={{ width: triggerRef?.current?.clientWidth }}
            role="listbox"
            aria-label="Week start options"
          >
            {OPTIONS.map((option) => {
              const isSelected = selectedOption.value === option.value;
              return (
                <div
                  key={option.value}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:cursor-pointer hover:bg-gray-50"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => handleSelect(option.value)}
                  onKeyDown={handleActivationKeyPress(() =>
                    handleSelect(option.value)
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {option.label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {option.description}
                    </span>
                  </div>
                  <When truthy={isSelected}>
                    <CheckIcon className="size-4 shrink-0 text-primary" />
                  </When>
                </div>
              );
            })}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    );
  }
  ```

- [ ] **Step 5: Typecheck and re-run the test.**

  Run: `pnpm --filter @shelf/webapp typecheck`
  Expected: passes.
  Run: `pnpm webapp:test -- --run app/components/user/language-region/date-format-select.test.tsx`
  Expected: PASS (2 tests).

- [ ] **Step 6: Commit.**

  ```bash
  git add app/components/user/language-region/date-format-select.tsx \
          app/components/user/language-region/date-format-select.test.tsx \
          app/components/user/language-region/time-format-select.tsx \
          app/components/user/language-region/week-start-select.tsx
  git commit -m "feat(user): add small-enum format-preference selectors

  Controlled Popover listbox selectors for date format, time format, and week
  start. Each rides the surrounding form via a hidden input and exposes
  value/onChange so the parent can drive a live preview."
  ```

---

### Task 5.3: Build the searchable `TimezoneSelect`

**Files:** (Create: `app/components/user/language-region/timezone-select.tsx`; Test: `app/components/user/language-region/timezone-select.test.tsx`)
**Interfaces:** (Consumes: `Intl.supportedValuesOf("timeZone")` / Produces: controlled `TimezoneSelect` `{ name; value; onChange; className? }` rendering a hidden `<input name value>` — consumed by Task 5.4)

Built on the searchable `field-selector.tsx` Popover pattern (search input + arrow-key nav),
because the IANA list is ~400 entries. Options are sourced at module scope from
`Intl.supportedValuesOf("timeZone")` with a `try/catch` fallback array for older runtimes.

- [ ] **Step 1: Write a failing test for the module-scope option list + render.**

  Create `app/components/user/language-region/timezone-select.test.tsx`:

  ```tsx
  /**
   * TimezoneSelect — unit tests
   *
   * Verifies the searchable timezone selector renders the current value in its
   * trigger, exposes a non-empty option list (from Intl.supportedValuesOf with
   * a fallback), and submits the value through the hidden input named by `name`.
   *
   * @see {@link file://./timezone-select.tsx}
   */
  import { render, screen } from "@testing-library/react";
  import { describe, it, expect, vi } from "vitest";
  import { TIMEZONE_OPTIONS, TimezoneSelect } from "./timezone-select";

  describe("TimezoneSelect", () => {
    it("exposes a non-empty option list", () => {
      expect(TIMEZONE_OPTIONS.length).toBeGreaterThan(0);
      expect(TIMEZONE_OPTIONS).toContain("UTC");
    });

    it("renders the current value in the trigger", () => {
      render(
        <TimezoneSelect
          name="timeZone"
          value="Europe/London"
          onChange={vi.fn()}
        />
      );
      expect(screen.getByText("Europe/London")).toBeTruthy();
    });

    it("submits the current value via a hidden input", () => {
      const { container } = render(
        <TimezoneSelect
          name="timeZone"
          value="America/New_York"
          onChange={vi.fn()}
        />
      );
      const hidden = container.querySelector<HTMLInputElement>(
        'input[type="hidden"][name="timeZone"]'
      );
      expect(hidden?.value).toBe("America/New_York");
    });
  });
  ```

  Run: `pnpm webapp:test -- --run app/components/user/language-region/timezone-select.test.tsx`
  Expected: FAIL (module does not exist yet).

- [ ] **Step 2: Implement `TimezoneSelect`.**

  Create `app/components/user/language-region/timezone-select.tsx`:

  ```tsx
  /**
   * TimezoneSelect
   *
   * Controlled searchable Popover selector for the user's IANA time zone. Built
   * on the asset advanced-filter field-selector pattern (search input +
   * arrow-key navigation) because the IANA list is ~400 entries. Options come
   * from Intl.supportedValuesOf("timeZone") at module scope, with a small
   * fallback array for runtimes that lack it. The chosen value rides the
   * surrounding form via a hidden input named `name`.
   *
   * @see {@link file://./language-region-form.tsx}
   * @see {@link file://../../assets/assets-index/advanced-filters/field-selector.tsx}
   */
  import type { ChangeEvent, KeyboardEvent } from "react";
  import { useMemo, useRef, useState } from "react";
  import {
    Popover,
    PopoverContent,
    PopoverPortal,
    PopoverTrigger,
  } from "@radix-ui/react-popover";
  import { ChevronDownIcon, Search } from "lucide-react";
  import { handleActivationKeyPress } from "~/utils/keyboard";
  import { tw } from "~/utils/tw";

  /**
   * Minimal fallback list for runtimes without Intl.supportedValuesOf.
   * Kept short and representative — full coverage comes from the runtime call.
   */
  const TIMEZONE_FALLBACK: string[] = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];

  /**
   * The IANA time-zone list, computed once at module scope.
   * Guards `Intl.supportedValuesOf` (not universally available; TS lib may not
   * type it) and falls back to a representative subset on failure.
   */
  export const TIMEZONE_OPTIONS: string[] = (() => {
    try {
      const supported = (
        Intl as {
          supportedValuesOf?: (input: "timeZone") => string[];
        }
      ).supportedValuesOf;
      if (typeof supported === "function") {
        const list = supported("timeZone");
        if (Array.isArray(list) && list.length > 0) {
          // Ensure UTC is present so the hardcoded default is always selectable.
          return list.includes("UTC") ? list : ["UTC", ...list];
        }
      }
    } catch {
      // fall through to fallback
    }
    return TIMEZONE_FALLBACK;
  })();

  /** Props for the controlled timezone selector. */
  type TimezoneSelectProps = {
    /** Name of the hidden input the value is submitted under. */
    name: string;
    /** Current concrete IANA time-zone name. */
    value: string;
    /** Called with the newly-chosen IANA name. */
    onChange: (value: string) => void;
    /** Optional class applied to the trigger button. */
    className?: string;
  };

  /**
   * Controlled, searchable timezone dropdown.
   *
   * @param props.name - Hidden-input name for form submission
   * @param props.value - Current IANA time-zone name
   * @param props.onChange - Selection callback
   * @param props.className - Optional trigger class
   * @returns The timezone selector control
   */
  export function TimezoneSelect({
    name,
    value,
    onChange,
    className,
  }: TimezoneSelectProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);

    const filtered = useMemo(() => {
      if (!searchQuery) return TIMEZONE_OPTIONS;
      const q = searchQuery.toLowerCase();
      return TIMEZONE_OPTIONS.filter((tz) => tz.toLowerCase().includes(q));
    }, [searchQuery]);

    function handleSearch(event: ChangeEvent<HTMLInputElement>) {
      setSearchQuery(event.target.value);
      setSelectedIndex(0);
    }

    function handleSelect(tz: string) {
      onChange(tz);
      setIsOpen(false);
      setSearchQuery("");
    }

    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((prev) =>
            prev < filtered.length - 1 ? prev + 1 : prev
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          event.preventDefault();
          if (filtered[selectedIndex]) {
            handleSelect(filtered[selectedIndex]);
          }
          break;
      }
    }

    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            // type="button" required by local-rules/require-button-type.
            type="button"
            className={tw(
              "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left",
              className
            )}
          >
            <span className="truncate text-sm font-medium text-gray-900">
              {value}
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-gray-500" />
            <input type="hidden" name={name} value={value} />
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className="z-[999999] max-h-[400px] overflow-scroll rounded-md border border-gray-200 bg-white"
            style={{ width: triggerRef?.current?.clientWidth }}
            role="listbox"
            aria-label="Time zone options"
          >
            <div className="flex items-center border-b">
              <Search className="ml-4 size-4 text-gray-500" />
              <input
                placeholder="Search time zone..."
                className="border-0 px-4 py-2 pl-2 text-sm focus:border-0 focus:ring-0"
                value={searchQuery}
                onChange={handleSearch}
                onKeyDown={handleKeyDown}
              />
            </div>
            {filtered.map((tz, index) => (
              <div
                key={tz}
                className={tw(
                  "px-4 py-2 text-sm text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                  selectedIndex === index && "bg-gray-50",
                  tz === value && "font-medium text-gray-900"
                )}
                role="option"
                aria-selected={tz === value}
                tabIndex={0}
                onClick={() => handleSelect(tz)}
                onKeyDown={handleActivationKeyPress(() => handleSelect(tz))}
              >
                {tz}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-2 text-sm text-gray-500">
                No time zones found
              </div>
            )}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    );
  }
  ```

- [ ] **Step 3: Run the test + typecheck.**

  Run: `pnpm webapp:test -- --run app/components/user/language-region/timezone-select.test.tsx`
  Expected: PASS (3 tests).
  Run: `pnpm --filter @shelf/webapp typecheck`
  Expected: passes.

- [ ] **Step 4: Commit.**

  ```bash
  git add app/components/user/language-region/timezone-select.tsx \
          app/components/user/language-region/timezone-select.test.tsx
  git commit -m "feat(user): add searchable timezone selector

  Controlled Popover with search + arrow-key nav over the IANA list from
  Intl.supportedValuesOf, guarded with a fallback array. Rides the form via a
  hidden input."
  ```

---

### Task 5.4: Build `LanguageRegionForm` Card + `FormatPrefsFormSchema` + live preview

**Files:** (Create: `app/components/user/language-region/language-region-form.tsx`; Test: `app/components/user/language-region/language-region-form.test.tsx`)
**Interfaces:** (Consumes: `DateFormatSelect`/`TimeFormatSelect`/`WeekStartSelect`/`TimezoneSelect` (Tasks 5.2-5.3), `useFormatPrefs()` → `ResolvedFormatPrefs` (Phase 3), `formatDate` + `ResolvedFormatPrefs` (Phase 2), `getValidationErrors` / `useDisabled`, `getUserWithContact` return type / Produces: `LanguageRegionForm` component + `FormatPrefsFormSchema` (Zod) — both consumed by Task 5.5)

- [ ] **Step 1: Write a failing test for `FormatPrefsFormSchema`.**

  Create `app/components/user/language-region/language-region-form.test.tsx`:

  ```tsx
  /**
   * LanguageRegionForm / FormatPrefsFormSchema — unit tests
   *
   * Verifies the Zod schema accepts the four concrete format-preference fields
   * (enum-validated + a valid IANA timezone string) and rejects invalid enum
   * members and empty/unknown time zones.
   *
   * @see {@link file://./language-region-form.tsx}
   */
  import { describe, it, expect } from "vitest";
  import { FormatPrefsFormSchema } from "./language-region-form";

  describe("FormatPrefsFormSchema", () => {
    it("accepts valid concrete preferences", () => {
      const result = FormatPrefsFormSchema.safeParse({
        dateFormat: "DD_MM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "Europe/London",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an invalid date-format enum member", () => {
      const result = FormatPrefsFormSchema.safeParse({
        dateFormat: "AUTO",
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "Europe/London",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an unknown time zone", () => {
      const result = FormatPrefsFormSchema.safeParse({
        dateFormat: "DD_MM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "Not/AZone",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty time zone", () => {
      const result = FormatPrefsFormSchema.safeParse({
        dateFormat: "DD_MM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "",
      });
      expect(result.success).toBe(false);
    });
  });
  ```

  Run: `pnpm webapp:test -- --run app/components/user/language-region/language-region-form.test.tsx`
  Expected: FAIL (module does not exist yet).

- [ ] **Step 2: Implement `language-region-form.tsx` (schema + component + live preview).**

  Create `app/components/user/language-region/language-region-form.tsx`:

  ```tsx
  /**
   * LanguageRegionForm
   *
   * Account-settings Card letting a user set their four formatting preferences
   * (date format, time format, week start, time zone). Selections are lifted
   * into local state so a live "Dates will look like…" preview — driven by the
   * pure formatDate(new Date(), livePrefs) — updates as the user changes fields.
   * Submits under the `updateFormatPrefs` intent; the four selectors ride the
   * <Form> via their hidden inputs.
   *
   * Values are always concrete — there is no "Automatic" option. A user whose
   * DB field is still null sees the hint-detected value (via useFormatPrefs) as
   * the initial selection.
   *
   * @see {@link file://../../../routes/_layout+/account-details.general.tsx}
   * @see {@link file://../../../utils/date-format.ts} formatDate
   */
  import { useState } from "react";

  import type {
    DateFormatPreference,
    TimeFormatPreference,
    WeekStartPreference,
  } from "@prisma/client";
  import {
    DateFormatPreference as DateFormatPreferenceEnum,
    TimeFormatPreference as TimeFormatPreferenceEnum,
    WeekStartPreference as WeekStartPreferenceEnum,
  } from "@prisma/client";
  import { useActionData } from "react-router";
  import { useZorm } from "react-zorm";
  import { z } from "zod";
  import { Form } from "~/components/custom-form";
  import FormRow from "~/components/forms/form-row";
  import { Button } from "~/components/shared/button";
  import { Card } from "~/components/shared/card";
  import { useDisabled } from "~/hooks/use-disabled";
  import { useFormatPrefs } from "~/hooks/use-format-prefs";
  import type { getUserWithContact } from "~/modules/user/service.server";
  import type { UserPageActionData } from "~/routes/_layout+/account-details.general";
  import { formatDate } from "~/utils/date-format";
  import type { ResolvedFormatPrefs } from "~/utils/date-format";
  import { getValidationErrors } from "~/utils/http";
  import { DateFormatSelect } from "./date-format-select";
  import { TimeFormatSelect } from "./time-format-select";
  import { TimezoneSelect } from "./timezone-select";
  import { WeekStartSelect } from "./week-start-select";

  /**
   * Validates whether a string is a resolvable IANA time-zone name.
   * `Intl.DateTimeFormat` throws a RangeError for unknown zones.
   *
   * @param tz - Candidate IANA name
   * @returns true if the runtime accepts it as a time zone
   */
  function isValidTimeZone(tz: string): boolean {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Server-and-client schema for the format-preference form. All four fields
   * are required + concrete (enum-validated; timezone must be a real IANA name).
   */
  export const FormatPrefsFormSchema = z.object({
    dateFormat: z.nativeEnum(DateFormatPreferenceEnum),
    timeFormat: z.nativeEnum(TimeFormatPreferenceEnum),
    weekStart: z.nativeEnum(WeekStartPreferenceEnum),
    timeZone: z
      .string()
      .min(1, "Time zone is required")
      .refine(isValidTimeZone, "Invalid time zone"),
  });

  /** Maps the WeekStartPreference enum to react-day-picker's weekStartsOn. */
  const WEEK_START_TO_DAY: Record<WeekStartPreference, 0 | 1 | 6> = {
    MONDAY: 1,
    SUNDAY: 0,
    SATURDAY: 6,
  };

  /** Inverse of WEEK_START_TO_DAY — resolves a default enum from resolved prefs. */
  const DAY_TO_WEEK_START: Record<0 | 1 | 6, WeekStartPreference> = {
    0: "SUNDAY",
    1: "MONDAY",
    6: "SATURDAY",
  };

  /**
   * Language & region settings Card.
   *
   * @param props.user - The current user (from getUserWithContact); its stored
   *   preferences seed the initial selection, falling back to hint-detected
   *   values for null fields.
   * @returns The language & region settings card
   */
  export function LanguageRegionForm({
    user,
  }: {
    user: ReturnType<typeof getUserWithContact>;
  }) {
    const zo = useZorm("LanguageRegionForm", FormatPrefsFormSchema);
    const data = useActionData<UserPageActionData>();
    const disabled = useDisabled();

    // Resolved prefs (stored value → hint → hardcoded default) supply the
    // fallback for any DB field still null. Concrete values only.
    const resolved = useFormatPrefs();

    const validationErrors = getValidationErrors<typeof FormatPrefsFormSchema>(
      data?.error
    );

    // Lazy-initialized local selection. After mount these are user-controlled
    // and drive the live preview; they do NOT re-sync from props.
    const [dateFormat, setDateFormat] = useState<DateFormatPreference>(
      () => user?.dateFormat ?? resolved.dateFormat
    );
    const [timeFormat, setTimeFormat] = useState<TimeFormatPreference>(
      () => user?.timeFormat ?? resolved.timeFormat
    );
    const [weekStart, setWeekStart] = useState<WeekStartPreference>(
      () => user?.weekStart ?? DAY_TO_WEEK_START[resolved.weekStartsOn]
    );
    const [timeZone, setTimeZone] = useState<string>(
      () => user?.timeZone ?? resolved.timeZone
    );

    // Build concrete resolved prefs from the live selection for the preview.
    const livePrefs: ResolvedFormatPrefs = {
      dateFormat,
      timeFormat,
      weekStartsOn: WEEK_START_TO_DAY[weekStart],
      timeZone,
    };
    const preview = formatDate(new Date(), livePrefs, { includeTime: true });

    return (
      <Card className="my-0">
        <div className="mb-6">
          <h3 className="text-text-lg font-semibold">Language &amp; region</h3>
          <p className="text-sm text-gray-600">
            Choose how dates, times, and calendars appear for your account.
          </p>
        </div>
        <Form method="post" ref={zo.ref} replace>
          <FormRow
            rowLabel="Date format"
            className="border-b-0 border-t"
            required={false}
          >
            <DateFormatSelect
              name={zo.fields.dateFormat()}
              value={dateFormat}
              onChange={setDateFormat}
            />
            {validationErrors?.dateFormat?.message ? (
              <p className="text-sm text-error-500">
                {validationErrors.dateFormat.message}
              </p>
            ) : null}
          </FormRow>

          <FormRow rowLabel="Time format" required={false}>
            <TimeFormatSelect
              name={zo.fields.timeFormat()}
              value={timeFormat}
              onChange={setTimeFormat}
            />
            {validationErrors?.timeFormat?.message ? (
              <p className="text-sm text-error-500">
                {validationErrors.timeFormat.message}
              </p>
            ) : null}
          </FormRow>

          <FormRow rowLabel="Week starts on" required={false}>
            <WeekStartSelect
              name={zo.fields.weekStart()}
              value={weekStart}
              onChange={setWeekStart}
            />
            {validationErrors?.weekStart?.message ? (
              <p className="text-sm text-error-500">
                {validationErrors.weekStart.message}
              </p>
            ) : null}
          </FormRow>

          <FormRow rowLabel="Time zone" required={false}>
            <TimezoneSelect
              name={zo.fields.timeZone()}
              value={timeZone}
              onChange={setTimeZone}
            />
            {validationErrors?.timeZone?.message ||
            zo.errors.timeZone()?.message ? (
              <p className="text-sm text-error-500">
                {validationErrors?.timeZone?.message ||
                  zo.errors.timeZone()?.message}
              </p>
            ) : null}
          </FormRow>

          <div
            className="mt-2 flex items-center gap-2 text-xs text-gray-500"
            aria-live="polite"
          >
            <span>Dates will look like:</span>
            <span className="font-medium text-gray-700">{preview}</span>
          </div>

          <div className="mt-4 text-right">
            <input type="hidden" name="type" value="updateFormatPrefs" />
            <Button
              disabled={disabled}
              type="submit"
              name="intent"
              value="updateFormatPrefs"
            >
              {disabled ? "Saving..." : "Save"}
            </Button>
          </div>
        </Form>
      </Card>
    );
  }
  ```

  Note: the `text-error-500` utility is the repo's error text color used in shared inputs;
  if `Input`'s `error` prop is preferred, these selectors are custom controls so the inline
  `<p>` fallback is used instead. Adjust the class to the repo's error token if it differs
  (grep `text-error-` under `app/components/forms`).

- [ ] **Step 3: Run the schema test + typecheck.**

  Run: `pnpm webapp:test -- --run app/components/user/language-region/language-region-form.test.tsx`
  Expected: PASS (4 tests).
  Run: `pnpm --filter @shelf/webapp typecheck`
  Expected: passes (`formatDate`, `ResolvedFormatPrefs`, `useFormatPrefs` come from Phase 2/3;
  confirm those are merged before running this phase).

- [ ] **Step 4: Commit.**

  ```bash
  git add app/components/user/language-region/language-region-form.tsx \
          app/components/user/language-region/language-region-form.test.tsx
  git commit -m "feat(user): add LanguageRegionForm card with live preview

  Assembles the four format-preference selectors into an account-settings Card.
  Lifts selection into local state to drive a live formatDate() preview in an
  aria-live region. FormatPrefsFormSchema validates the four concrete fields."
  ```

---

### Task 5.5: Wire the `updateFormatPrefs` intent + mount the Card

**Files:** (Modify: `app/routes/_layout+/account-details.general.tsx:59-69` (IntentSchema), `:72-105` (ActionSchemas), `:141-249` (switch), `:449-486` (render); Test: `app/routes/_layout+/account-details.general.test.ts`)
**Interfaces:** (Consumes: `LanguageRegionForm` + `FormatPrefsFormSchema` (Task 5.4), `UpdateUserPayload` (Task 5.1), `updateUser` / `sendNotification` / `payload` / `parseData` / `requirePermission` / `createActionArgs` / `updateProfilePicture`-not-called / Produces: `updateFormatPrefs` action intent persisting the four fields)

- [ ] **Step 1: Import `LanguageRegionForm` + `FormatPrefsFormSchema`.**

  In `account-details.general.tsx`, after the `DisplayNameForm` import block (lines 16-19), add:

  ```ts
  import {
    LanguageRegionForm,
    FormatPrefsFormSchema,
  } from "~/components/user/language-region/language-region-form";
  ```

- [ ] **Step 2: Add `updateFormatPrefs` to `IntentSchema`.**

  Replace the enum (lines 59-69):

  ```ts
  const IntentSchema = z.object({
    intent: z.enum([
      "resetPassword",
      "updateUser",
      "updateDisplayName",
      "deleteUser",
      "initiateEmailChange",
      "verifyEmailChange",
      "updateUserContact",
    ]),
  });
  ```

  with:

  ```ts
  const IntentSchema = z.object({
    intent: z.enum([
      "resetPassword",
      "updateUser",
      "updateDisplayName",
      "deleteUser",
      "initiateEmailChange",
      "verifyEmailChange",
      "updateUserContact",
      "updateFormatPrefs",
    ]),
  });
  ```

- [ ] **Step 3: Add the `updateFormatPrefs` schema to `ActionSchemas`.**

  Inside the `ActionSchemas` object (after the `updateDisplayName` entry at lines 81-83), add:

  ```ts
    updateFormatPrefs: FormatPrefsFormSchema.extend({
      type: z.literal("updateFormatPrefs"),
    }),
  ```

- [ ] **Step 4: Add the `updateFormatPrefs` case to the switch.**

  Immediately after the `updateDisplayName` case closes (after line 220, before
  `case "updateUserContact"`), insert:

  ```ts
        case "updateFormatPrefs": {
          if (parsedData.type !== "updateFormatPrefs")
            throw new Error("Invalid payload type");

          await updateUser({
            id: userId,
            dateFormat: parsedData.dateFormat,
            timeFormat: parsedData.timeFormat,
            weekStart: parsedData.weekStart,
            timeZone: parsedData.timeZone,
          });

          sendNotification({
            title: "Preferences updated",
            message:
              "Your language & region settings have been updated successfully",
            icon: { name: "success", variant: "success" },
            senderId: authSession.userId,
          });

          return payload({ success: true });
        }
  ```

- [ ] **Step 5: Mount the Card in the render.**

  Replace the render's form stack top (lines 453-456):

  ```ts
      <div className="mb-2.5 flex flex-col justify-between gap-3">
        <UserDetailsForm user={user} />
        {user.sso ? <DisplayNameForm user={user} /> : null}
        <UserContactDetailsForm user={user} />
  ```

  with:

  ```ts
      <div className="mb-2.5 flex flex-col justify-between gap-3">
        <UserDetailsForm user={user} />
        {user.sso ? <DisplayNameForm user={user} /> : null}
        <UserContactDetailsForm user={user} />
        <LanguageRegionForm user={user} />
  ```

- [ ] **Step 6: Write a test for the `updateFormatPrefs` action case.**

  Create `app/routes/_layout+/account-details.general.test.ts`:

  ```ts
  /**
   * account-details.general action — updateFormatPrefs intent test
   *
   * Verifies the settings action parses the four concrete format-preference
   * fields and forwards them to updateUser with the caller's id.
   *
   * @see {@link file://./account-details.general.tsx}
   */
  import { beforeEach, describe, expect, it, vi } from "vitest";
  import { createActionArgs } from "@mocks/remix";

  import * as userService from "~/modules/user/service.server";
  import * as rolesServer from "~/utils/roles.server";

  import { action } from "./account-details.general";

  // @vitest-environment node

  // why: isolate the action from the real permission check + DB write; we only
  // assert the parse → updateUser wiring for the new intent.
  vi.mock("~/modules/user/service.server", () => ({
    updateUser: vi.fn(),
    updateProfilePicture: vi.fn(),
    getUserByID: vi.fn(),
    getUserWithContact: vi.fn(),
    updateUserEmail: vi.fn(),
  }));

  vi.mock("~/utils/roles.server", () => ({
    requirePermission: vi.fn(),
  }));

  // why: sendNotification pushes to an SSE emitter with no test transport.
  vi.mock("~/utils/emitter/send-notification.server", () => ({
    sendNotification: vi.fn(),
  }));

  describe("account-details.general action — updateFormatPrefs", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(rolesServer.requirePermission).mockResolvedValue({} as never);
    });

    it("forwards the four concrete fields to updateUser", async () => {
      const body = new URLSearchParams({
        intent: "updateFormatPrefs",
        type: "updateFormatPrefs",
        dateFormat: "DD_MM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "Europe/London",
      });

      const request = new Request("http://localhost/account-details/general", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const context = {
        getSession: () => ({
          userId: "user-1",
          email: "u@example.com",
        }),
      };

      await action(createActionArgs({ request, context: context as never }));

      expect(userService.updateUser).toHaveBeenCalledWith({
        id: "user-1",
        dateFormat: "DD_MM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "Europe/London",
      });
    });
  });
  ```

  Run: `pnpm webapp:test -- --run app/routes/_layout+/account-details.general.test.ts`
  Expected: PASS. If additional imports in the route module require mocking (the test loads the
  whole route file), add them to the `vi.mock` blocks — mock only what the module imports at
  top level, keeping each `// why:` justified.

- [ ] **Step 7: Typecheck + manual verification.**

  Run: `pnpm --filter @shelf/webapp typecheck`
  Expected: passes.

  Manual verification (dev server):

  1. `pnpm webapp:dev`, log in, open `/account-details/general`.
  2. Confirm the "Language & region" Card renders below Contact details, with the four
     selectors defaulted to the current effective values (hint-detected if never set).
  3. Change Date format → confirm the "Dates will look like:" preview updates live.
  4. Change Time format to 24-hour → confirm the preview's time portion switches.
  5. Click Save → confirm the "Preferences updated" success toast and that the values persist
     across a reload.

- [ ] **Step 8: Commit.**

  ```bash
  git add app/routes/_layout+/account-details.general.tsx \
          app/routes/_layout+/account-details.general.test.ts
  git commit -m "feat(user): wire updateFormatPrefs intent and mount settings card

  Adds the updateFormatPrefs intent (schema + action case persisting the four
  format fields via updateUser) and mounts LanguageRegionForm on the General
  account tab. Covers the action wiring with a focused test."
  ```

---

### Phase 5 completion check

- [ ] **Step 1: Full validation.**

  Run: `pnpm webapp:validate`
  Expected: Prisma generate, ESLint, Prettier, typecheck, and all Phase-5 tests pass.
  Kill any lingering vitest watch processes afterward.

**Notes for the executor:**

- All preference values are **concrete** — there is no "Automatic" option. A `null` DB field
  is never shown as "Automatic"; instead its selector defaults to the hint-detected value via
  `useFormatPrefs()` (Phase 3), so what the user sees pre-save matches what rows already render.
- `getUserWithContact` needs **no** `select` change: it uses `include`, so Prisma returns all
  User scalar columns (including the four new ones) automatically. `updateUser` needs no change
  either: it spreads the payload into `db.user.update({ data })`, so the Task-5.1 fields flow
  through once they exist on `UpdateUserPayload`.
- This phase depends on Phase 1 (enums + columns), Phase 2 (`formatDate`, `ResolvedFormatPrefs`,
  the three preference enum types) and Phase 3 (`useFormatPrefs`). Do not start until those are
  merged into the working branch, or typecheck in Tasks 5.2-5.5 will fail on missing imports.
- No migrations are authored in this phase; the schema/enum work is Phase 1's SQL migration
  files. Do **not** run `db:prepare-migration` / `db:deploy-migration` here.

---

## Phase 6: Client display sweep — kill hardcoded locales, route every client date render through user prefs

This phase converts every CLIENT (non-`.server`, non-email) date render that
currently bypasses `DateS` — hardcoded `"en-US"`, `"default"`, browser-default
`toLocaleDateString()`, and `Intl.DateTimeFormat(hints.locale)` — onto the new
user-preference formatting layer produced by Phases 2/3. Components consume the
`useDateFormatter()` hook (`{ prefs, formatDate, formatTime, formatDateTime }`).
Pure helper functions (not components) are converted to accept a
`ResolvedFormatPrefs` (or a `formatDate` callback) parameter and their calling
components pass `useDateFormatter().prefs`. `date-format-selector.tsx` (A14) and
`getDateTimeFormatFromHints` (A15) are handled by other phases and are out of
scope here.

Consumed contract surface (frozen — do not rename):

- `formatDate(value: string | Date, prefs: ResolvedFormatPrefs, opts?: DateFormatOptions): string` and type `ResolvedFormatPrefs`, const `HARDCODED_DEFAULT_PREFS` — from `~/utils/date-format` (Phase 2).
- `useDateFormatter(): { prefs: ResolvedFormatPrefs; formatDate; formatTime; formatDateTime }` — from `~/hooks/use-date-formatter` (Phase 3).
- `DateFormatOptions` fields used here: `weekday`, `month`, `day`, `year`, `hour`, `minute`, `localeOnly`, `onlyTime`.

> **Prerequisite:** Phases 2 and 3 must be merged first — `~/utils/date-format`
> must export `formatDate` / `ResolvedFormatPrefs` / `HARDCODED_DEFAULT_PREFS`
> and `~/hooks/use-date-formatter` must export `useDateFormatter`. All tasks
> below reference these as existing.

---

### Task 6.1: Custom-field date spine — `formatDateBasedOnLocaleOnly` + `getCustomFieldDisplayValue` + 3 consumers (A3, A4)

**Files:**

- Modify: `app/utils/client-hints.tsx:192` (`formatDateBasedOnLocaleOnly`)
- Modify: `app/utils/custom-fields.ts:470` (signature) `:485-486` (body), `:7` (import), `:472` (param type)
- Modify: `app/components/assets/assets-index/advanced-asset-columns.tsx:109-112`
- Modify: `app/components/assets/custom-fields-inputs.tsx:15,53,58`
- Modify: `app/routes/_layout+/assets.$assetId.overview.tsx:1371-1374`
- Test: `app/utils/client-hints.test.tsx` (new), `app/utils/custom-fields.test.ts` (extend)

**Interfaces:**

- Consumes: `formatDate`, `ResolvedFormatPrefs` (`~/utils/date-format`); `useDateFormatter` (`~/hooks/use-date-formatter`).
- Produces: `formatDateBasedOnLocaleOnly(value: string, prefs: ResolvedFormatPrefs)`; `getCustomFieldDisplayValue(value, prefs?: ResolvedFormatPrefs)` — consumed by later reviewers of this file only.

- [ ] **Step 1: Write failing test for the new `formatDateBasedOnLocaleOnly` signature.** Create `app/utils/client-hints.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { formatDateBasedOnLocaleOnly } from "./client-hints";

/**
 * Regression guard: the custom-field date spine must render date-only values
 * using the caller's resolved prefs (absolute, no timezone conversion), NOT
 * the browser default locale it used before the configurable-format work.
 */
describe("formatDateBasedOnLocaleOnly", () => {
  const ddmmyyyy: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };
  const mmddyyyy: ResolvedFormatPrefs = {
    ...ddmmyyyy,
    dateFormat: "MM_DD_YYYY",
  };

  it("renders day-month-year order for DD_MM_YYYY prefs", () => {
    // components appear in order regardless of the separator the formatter uses
    expect(formatDateBasedOnLocaleOnly("2026-04-03", ddmmyyyy)).toMatch(
      /^0?3\D+0?4\D+2026$/
    );
  });

  it("renders month-day-year order for MM_DD_YYYY prefs", () => {
    expect(formatDateBasedOnLocaleOnly("2026-04-03", mmddyyyy)).toMatch(
      /^0?4\D+0?3\D+2026$/
    );
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.** `pnpm webapp:test -- --run app/utils/client-hints.test.tsx` — fails to compile / wrong arg type (current signature is `(value, locale: string)`).
- [ ] **Step 3: Convert `formatDateBasedOnLocaleOnly` to prefs.** In `app/utils/client-hints.tsx`, add a value import near the top (after existing imports) and replace the function at `:192`:

```tsx
import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";
```

```tsx
/**
 * Render a date-only string as an absolute (working-hours) date using the
 * caller's resolved format prefs — no timezone conversion. This is the spine
 * behind custom-field DATE display and calendar labels.
 *
 * @param value - ISO date-only or date-time string
 * @param prefs - Fully-resolved user format prefs
 * @returns Numeric date string in the user's configured order
 */
export function formatDateBasedOnLocaleOnly(
  value: string,
  prefs: ResolvedFormatPrefs
) {
  return formatDate(value, prefs, { localeOnly: true });
}
```

- [ ] **Step 4: Run the test — expect PASS.** `pnpm webapp:test -- --run app/utils/client-hints.test.tsx`.
- [ ] **Step 5: Thread prefs through `getCustomFieldDisplayValue`.** In `app/utils/custom-fields.ts`, change the type import at `:7` and the signature + date branch. Replace `import type { ClientHint } from "~/utils/client-hints";` with:

```ts
import type { ResolvedFormatPrefs } from "~/utils/date-format";
```

Then at `:470`, replace the signature and date branch:

```ts
/**
 * Produce the human-readable display value for a stored custom-field value.
 *
 * @param value - The stored custom-field value shape
 * @param prefs - Optional resolved format prefs; when supplied, DATE values
 *   render in the user's configured order (absolute, no tz conversion).
 *   When omitted, falls back to `PPP` (server / prefs-less contexts).
 * @returns A string or renderable Markdoc node
 */
export const getCustomFieldDisplayValue = (
  value: ShelfAssetCustomFieldValueType["value"],
  prefs?: ResolvedFormatPrefs
): string | RenderableTreeNode => {
```

and replace `:485-486`:

```ts
return prefs
  ? formatDateBasedOnLocaleOnly(value.raw as string, prefs)
  : format(parseDateOnlyString(value.raw as string), "PPP");
```

- [ ] **Step 6: Add a failing-then-passing test for the DATE branch.** Append to `app/utils/custom-fields.test.ts` a new block:

```ts
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { getCustomFieldDisplayValue } from "./custom-fields";

describe("getCustomFieldDisplayValue — DATE with prefs", () => {
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };

  it("renders a DATE value in the user's configured order when prefs are given", () => {
    const value = { raw: "2026-04-03", valueDate: "2026-04-03T00:00:00.000Z" };
    expect(getCustomFieldDisplayValue(value as never, prefs)).toMatch(
      /^0?3\D+0?4\D+2026$/
    );
  });

  it("falls back to PPP when no prefs are supplied", () => {
    const value = { raw: "2026-04-03", valueDate: "2026-04-03T00:00:00.000Z" };
    expect(getCustomFieldDisplayValue(value as never)).toBe("April 3rd, 2026");
  });
});
```

Run `pnpm webapp:test -- --run app/utils/custom-fields.test.ts` — expect PASS (both new + existing).

- [ ] **Step 7: Update consumer — `advanced-asset-columns.tsx`.** The component already destructures `locale`/`timeZone` from the loader (still used elsewhere in the file at `:147,:251`); only change the custom-field call. Add near the other hooks (after `:85`):

```tsx
const { prefs } = useDateFormatter();
```

Add the import with the other `~/hooks` imports:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Replace `:109-112`:

```tsx
const customFieldDisplayValue = getCustomFieldDisplayValue(fieldValue, prefs);
```

- [ ] **Step 8: Update consumer — `custom-fields-inputs.tsx`.** `hints` is used ONLY at `:58`. Replace the `useHints` import at `:15`:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Replace `:53`:

```tsx
const { prefs } = useDateFormatter();
```

Replace `:58`:

```tsx
return value ? (getCustomFieldDisplayValue(value, prefs) as string) : "";
```

- [ ] **Step 9: Update consumer — `assets.$assetId.overview.tsx`.** The component destructures `locale`/`timeZone` from the loader (still used elsewhere); add the hook. Add import with the other `~/hooks` imports:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Add inside `AssetOverview()` after the `useLoaderData` destructure (`:866`):

```tsx
const { prefs } = useDateFormatter();
```

Replace `:1371-1374`:

```tsx
const customFieldDisplayValue = hasValue
  ? getCustomFieldDisplayValue(fieldValue!, prefs)
  : null;
```

- [ ] **Step 10: Typecheck.** `pnpm --filter @shelf/webapp typecheck` — expect no errors (confirms all three consumers now pass `ResolvedFormatPrefs`, and no other caller of `getCustomFieldDisplayValue` was missed). Manual check: `/assets` advanced index with a DATE custom-field column, the asset overview custom-fields list, and the add-asset custom-field input placeholder all show the DATE in the user's configured order.
- [ ] **Step 11: Commit.**

```
git commit -am "feat(dates): route custom-field date spine through user format prefs

Convert formatDateBasedOnLocaleOnly and getCustomFieldDisplayValue to take
ResolvedFormatPrefs and thread useDateFormatter().prefs from the three client
consumers (advanced columns, custom-field inputs, asset overview)."
```

---

### Task 6.2: Command palette — audit due date + booking range (A1, A2)

**Files:**

- Modify: `app/components/layout/command-palette/command-palette.tsx:733`, `:787-789`

**Interfaces:**

- Consumes: `useDateFormatter` (`~/hooks/use-date-formatter`).
- Produces: none (leaf UI).

- [ ] **Step 1: Import the hook.** Add to `app/components/layout/command-palette/command-palette.tsx` with the other `~/hooks` imports (near `:30-32`):

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

- [ ] **Step 2: Pull the formatter into the component.** Inside the component that renders the results list (the same one holding `handleSelect`), add near the top of the component body:

```tsx
const { formatDate } = useDateFormatter();
```

- [ ] **Step 3: Replace the audit due-date render (A1).** Replace `:733`:

```tsx
                      ? ` • Due ${formatDate(audit.dueDate)}`
```

- [ ] **Step 4: Replace the booking range render (A2).** Replace `:787-789`:

```tsx
{
  booking.from && booking.to
    ? ` • ${formatDate(booking.from)} - ${formatDate(booking.to)}`
    : "";
}
```

- [ ] **Step 5: Typecheck + manual.** `pnpm --filter @shelf/webapp typecheck` — expect no errors. Manual: open the command palette (Cmd-K), search an audit with a due date and a booking with a range; both dates render in the user's configured numeric order (no more raw browser-default `toLocaleDateString()`).
- [ ] **Step 6: Commit.**

```
git commit -am "feat(dates): format command-palette audit/booking dates via user prefs

Replace raw new Date(...).toLocaleDateString() with useDateFormatter().formatDate
for the audit due-date and booking from-to range in the command palette."
```

---

### Task 6.3: Calendar titles + week range (A5, A6, A7)

**Files:**

- Modify: `app/utils/date-fns.ts:78` (`getWeekStartingAndEndingDates`), `:1` (import)
- Modify: `app/utils/calendar.ts:267` (`getCalendarTitleAndSubtitle`), `:275`, `:287-292`, `:1-7` (imports)
- Modify: `app/components/calendar/title-container.tsx:1,23-29`
- Modify: `app/components/availability-calendar/availability-calendar.tsx:47,62`
- Modify: `app/routes/_layout+/calendar.tsx:212,245`
- Test: `app/utils/date-fns.test.ts` (new)

**Interfaces:**

- Consumes: `formatDate`, `ResolvedFormatPrefs` (`~/utils/date-format`); `useDateFormatter` (`~/hooks/use-date-formatter`).
- Produces: `getWeekStartingAndEndingDates(currentDate: Date, prefs: ResolvedFormatPrefs)`; `getCalendarTitleAndSubtitle({ viewType, calendarApi, prefs })`.

- [ ] **Step 1: Write failing test for `getWeekStartingAndEndingDates`.** Create `app/utils/date-fns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { getWeekStartingAndEndingDates } from "./date-fns";

/**
 * Guard: the calendar week-range subtitle must render its endpoints through
 * the user's resolved prefs (absolute day/month), not the browser default.
 */
describe("getWeekStartingAndEndingDates", () => {
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };

  it("returns Monday-based start/end labels with day + long month", () => {
    // 2026-04-15 is a Wednesday → week is Mon 13th … Sun 19th April
    const [start, end] = getWeekStartingAndEndingDates(
      new Date(2026, 3, 15),
      prefs
    );
    expect(start).toMatch(/13/);
    expect(start).toMatch(/April/);
    expect(end).toMatch(/19/);
    expect(end).toMatch(/April/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm webapp:test -- --run app/utils/date-fns.test.ts` (current signature takes only `currentDate`).
- [ ] **Step 3: Convert `getWeekStartingAndEndingDates`.** In `app/utils/date-fns.ts`, add the import at the top (after `:2`):

```ts
import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";
```

Replace the body at `:78` (keep the existing Monday-based boundary math; only the label formatting changes — week-boundary alignment to `prefs.weekStartsOn` is intentionally left to the calendar picker phase):

```ts
/**
 * Compute the Monday–Sunday range that contains `currentDate` and return the
 * two endpoints formatted (day + long month) in the user's configured order.
 *
 * @param currentDate - Any date within the target week
 * @param prefs - Resolved user format prefs (drives endpoint formatting)
 * @returns `[startLabel, endLabel]`
 */
export function getWeekStartingAndEndingDates(
  currentDate: Date,
  prefs: ResolvedFormatPrefs
) {
  // Get the day of the week as a number (0 for Sunday, 1 for Monday, etc.)
  const day = currentDate.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1; // if day is Sunday(0), set diffToMonday as 6, else day - 1

  // Calculate the start of the week
  const start = new Date(currentDate);
  start.setDate(currentDate.getDate() - diffToMonday);

  // Calculate the end of the week
  const end = new Date(currentDate);
  end.setDate(start.getDate() + 6);

  // Format the endpoints per the user's prefs (absolute, no tz conversion)
  const options = { day: "numeric", month: "long" } as const;
  const startStr = formatDate(start, prefs, { ...options, localeOnly: true });
  const endStr = formatDate(end, prefs, { ...options, localeOnly: true });

  return [startStr, endStr];
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm webapp:test -- --run app/utils/date-fns.test.ts`.
- [ ] **Step 5: Convert `getCalendarTitleAndSubtitle` (A5).** In `app/utils/calendar.ts`, add the import (after `:6`):

```ts
import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";
```

Replace the function at `:267`:

```ts
/**
 * Build the calendar header title + subtitle for the current view, formatting
 * every visible date through the user's resolved prefs (absolute).
 *
 * @param viewType - FullCalendar view name (…Week / …Day / month)
 * @param calendarApi - The CalendarApi instance to read the current date from
 * @param prefs - Resolved user format prefs
 */
export function getCalendarTitleAndSubtitle({
  viewType,
  calendarApi,
  prefs,
}: {
  viewType: string;
  calendarApi: CalendarApi;
  prefs: ResolvedFormatPrefs;
}) {
  const currentDate = calendarApi.getDate();
  const currentYear = currentDate.getFullYear();
  const monthYear = formatDate(currentDate, prefs, {
    month: "long",
    year: "numeric",
    localeOnly: true,
  });

  let title = monthYear;
  let subtitle = "";

  if (viewType.endsWith("Week")) {
    const [startingDay, endingDay] = getWeekStartingAndEndingDates(
      currentDate,
      prefs
    );

    title = monthYear;
    subtitle = `Week ${startingDay} - ${endingDay}`;
  } else if (viewType.endsWith("Day")) {
    const formattedDate = formatDate(currentDate, prefs, {
      day: "numeric",
      month: "long",
      year: "numeric",
      localeOnly: true,
    });
    const weekday = formatDate(currentDate, prefs, {
      weekday: "long",
      localeOnly: true,
    });
    title = formattedDate;
    subtitle = weekday;
  }

  return { title, subtitle };
}
```

- [ ] **Step 6: Convert `title-container.tsx` (A6).** In `app/components/calendar/title-container.tsx`, add the hook import at the top:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Add inside the component (before the `useMemo`):

```tsx
const { formatDate } = useDateFormatter();
```

Replace the `useMemo` body at `:23-29`:

```tsx
const titleToRender = useMemo(() => {
  if (calendarTitle) {
    return calendarTitle;
  }

  const currentDate = new Date();
  return formatDate(currentDate, {
    month: "long",
    year: "numeric",
    localeOnly: true,
  });
}, [calendarTitle, formatDate]);
```

- [ ] **Step 7: Update caller — `availability-calendar.tsx`.** Add hook import:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Add near the other hooks in the component (before `:47`):

```tsx
const { prefs } = useDateFormatter();
```

Replace `:47`:

```tsx
const [startingDay, endingDay] = getWeekStartingAndEndingDates(
  new Date(),
  prefs
);
```

Replace `:62`:

```tsx
setCalendarHeader(
  getCalendarTitleAndSubtitle({ viewType, calendarApi, prefs })
);
```

- [ ] **Step 8: Update caller — `calendar.tsx`.** Add hook import:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Add near the other hooks in `Calendar()` (before `:212`):

```tsx
const { prefs } = useDateFormatter();
```

Replace `:212`:

```tsx
const [startingDay, endingDay] = getWeekStartingAndEndingDates(
  new Date(),
  prefs
);
```

Replace `:245`:

```tsx
setCalendarHeader(
  getCalendarTitleAndSubtitle({ viewType, calendarApi, prefs })
);
```

- [ ] **Step 9: Typecheck + manual.** `pnpm --filter @shelf/webapp typecheck` — expect no errors (compiler forces both callers of each helper to supply `prefs`). Manual: open `/calendar` and the asset availability calendar; verify month/week/day header titles and the "Week X - Y" subtitle render in the user's configured order.
- [ ] **Step 10: Commit.**

```
git commit -am "feat(dates): format calendar titles and week range via user prefs

Convert getWeekStartingAndEndingDates and getCalendarTitleAndSubtitle to accept
ResolvedFormatPrefs; TitleContainer, availability-calendar, and the calendar
route now pass useDateFormatter().prefs. Drops the 'default'-locale renders."
```

---

### Task 6.4: Reports timeframe labels + pickers (A8, A9, A10)

**Files:**

- Modify: `app/modules/reports/timeframe.ts:20` (`resolveTimeframe` sig), `:146-155` (`formatMonthLabel`, `formatDateShort`), `:79,:90,:136` (call sites), imports
- Modify: `app/components/reports/timeframe-picker.tsx:25`, `:105`, `:124`, `:267-268`, `:308-314`
- Modify: `app/components/reports/compliance-hero.tsx:38-50`, `:55-72`
- Test: `app/modules/reports/timeframe.test.ts` (new)

**Interfaces:**

- Consumes: `formatDate`, `ResolvedFormatPrefs`, `HARDCODED_DEFAULT_PREFS` (`~/utils/date-format`); `useDateFormatter` (`~/hooks/use-date-formatter`).
- Produces: `resolveTimeframe(preset, customFrom?, customTo?, prefs?: ResolvedFormatPrefs)` (prefs optional, defaults to `HARDCODED_DEFAULT_PREFS`).

> **Cross-check with Phase 7 (server sweep):** `timeframe.ts` has no `.server`
> suffix and `resolveTimeframe` runs on BOTH the client (`timeframe-picker.tsx`)
> and the server (`reports.$reportId.tsx`, `reports.export.$fileName[.csv].tsx`,
> `api+/reports.$reportId.generate-pdf.tsx`). This task makes `prefs` an
> OPTIONAL last parameter defaulting to `HARDCODED_DEFAULT_PREFS`, so the server
> call sites keep compiling and rendering en-US-order labels until Phase 7
> threads server-resolved prefs into them. Phase 7 owns updating those three
> route call sites to pass the acting user's resolved prefs.

- [ ] **Step 1: Write failing test for the label helpers via `resolveTimeframe`.** Create `app/modules/reports/timeframe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { resolveTimeframe } from "./timeframe";

/**
 * Guard: custom-range and month timeframe labels must render in the caller's
 * configured order (no hardcoded "en-US"). Month/day names stay English by
 * design (the formatter reassembles en-US parts), only ORDER is prefs-driven.
 */
describe("resolveTimeframe labels", () => {
  const ddmmyyyy: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };

  it("renders a custom range with day-first order for DD_MM_YYYY prefs", () => {
    const from = new Date(2026, 3, 3); // 3 Apr 2026
    const to = new Date(2026, 3, 10); // 10 Apr 2026
    const resolved = resolveTimeframe("custom", from, to, ddmmyyyy);
    // "3 Apr 2026 – 10 Apr 2026" — day appears before the month token
    expect(resolved.label).toMatch(/^0?3\D+Apr\D+2026\s*–\s*10\D+Apr\D+2026$/);
  });

  it("still resolves preset labels without prefs (server fallback)", () => {
    expect(resolveTimeframe("last_7d").label).toBe("Last 7 days");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm webapp:test -- --run app/modules/reports/timeframe.test.ts`.
- [ ] **Step 3: Thread prefs through `resolveTimeframe` + helpers.** In `app/modules/reports/timeframe.ts`, add the import near the top:

```ts
import {
  formatDate,
  HARDCODED_DEFAULT_PREFS,
  type ResolvedFormatPrefs,
} from "~/utils/date-format";
```

Change the signature at `:20`:

```ts
export function resolveTimeframe(
  preset: TimeframePreset,
  customFrom?: Date,
  customTo?: Date,
  prefs: ResolvedFormatPrefs = HARDCODED_DEFAULT_PREFS
): ResolvedTimeframe {
```

Update the three label call sites — `:79` and `:90` (`this_month`/`last_month`):

```ts
        label: formatMonthLabel(from, prefs),
```

and the custom-range case at `:136`:

```ts
        label: `${formatDateShort(customFrom, prefs)} – ${formatDateShort(
          customTo,
          prefs
        )}`,
```

Replace the two helper functions at `:146-155`:

```ts
function formatMonthLabel(date: Date, prefs: ResolvedFormatPrefs): string {
  return formatDate(date, prefs, {
    month: "long",
    year: "numeric",
    localeOnly: true,
  });
}

function formatDateShort(date: Date, prefs: ResolvedFormatPrefs): string {
  return formatDate(date, prefs, {
    month: "short",
    day: "numeric",
    year: "numeric",
    localeOnly: true,
  });
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm webapp:test -- --run app/modules/reports/timeframe.test.ts`.
- [ ] **Step 5: Wire the client picker to pass prefs + replace its footer formatter (A8).** In `app/components/reports/timeframe-picker.tsx`, add the hook import after `:25`:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Add at the top of the `TimeframePicker` component body (near the other hooks/state, before `:95`):

```tsx
const { prefs, formatDate: formatDatePref } = useDateFormatter();
```

Replace the preset call at `:105`:

```tsx
const resolved = resolveTimeframe(preset, undefined, undefined, prefs);
```

and add `prefs` to that `useCallback` dependency array (append `prefs`). Replace the custom call at `:124`:

```tsx
const resolved = resolveTimeframe(
  "custom",
  customRange.from,
  customRange.to,
  prefs
);
```

and add `prefs` to that `useCallback` dependency array. Replace the footer render at `:267-268`:

```tsx
                        {formatDatePref(customRange.from, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}{" "}
                        –{" "}
                        {formatDatePref(customRange.to, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
```

Delete the module-level `formatDate` helper at `:308-314` (now unused).

- [ ] **Step 6: Convert `compliance-hero.tsx` (A9).** In `app/components/reports/compliance-hero.tsx`, add the hook import:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Replace `formatPriorPeriodLabel` at `:38-50` to receive a `formatDate` callback instead of building its own hardcoded one:

```tsx
/**
 * Format the prior-period label, showing dates for custom ranges.
 *
 * @param periodLabel - Base label (e.g. "prior period")
 * @param formatDate - The user-prefs formatter from useDateFormatter()
 * @param fromDate - Custom range start (optional)
 * @param toDate - Custom range end (optional)
 */
function formatPriorPeriodLabel(
  periodLabel: string,
  formatDate: (value: string | Date, opts?: DateFormatOptions) => string,
  fromDate?: Date,
  toDate?: Date
): string {
  // For custom ranges, show the actual dates
  if (periodLabel === "prior period" && fromDate && toDate) {
    const fmt = (d: Date) => formatDate(d, { month: "short", day: "numeric" });
    return `${fmt(fromDate)} – ${fmt(toDate)}`;
  }
  return periodLabel;
}
```

Add the `DateFormatOptions` type import alongside the hook import:

```tsx
import type { DateFormatOptions } from "~/utils/date-format";
```

In the `ComplianceHero` component, add near the top of its body:

```tsx
const { formatDate } = useDateFormatter();
```

Replace the `formatPriorPeriodLabel` call at `:65-70`:

```tsx
const priorLabel = priorPeriod
  ? formatPriorPeriodLabel(
      priorPeriod.periodLabel,
      formatDate,
      priorPeriod.fromDate,
      priorPeriod.toDate
    )
  : "";
```

- [ ] **Step 7: Typecheck + manual.** `pnpm --filter @shelf/webapp typecheck` — expect no errors. Manual: open a report with the timeframe picker, pick a custom range → the picker footer AND the resolved report header label render in the user's configured order; the compliance report prior-period chip renders the custom range in prefs order.
- [ ] **Step 8: Commit.**

```
git commit -am "feat(dates): format report timeframe labels and pickers via user prefs

resolveTimeframe now takes an optional ResolvedFormatPrefs (defaults to the
hardcoded default for server callers, threaded by Phase 7). The timeframe picker
footer and compliance-hero prior-period label drop hardcoded en-US and use
useDateFormatter()."
```

---

### Task 6.5: Filter-preset summary chip — date value (A11)

**Files:**

- Modify: `app/modules/asset-filter-presets/format-filter-summary.ts:67` (`formatFilterSummary`), `:93` (`formatValue` call), `:163` (`formatValue` sig), `:195` (`formatSingleValue` sig), `:261-267` (date branch), `:173-189` (recursive calls), imports
- Modify: `app/hooks/use-filter-preview.tsx:20-59` (pass prefs)
- Test: `app/modules/asset-filter-presets/format-filter-summary.test.ts` (new)

**Interfaces:**

- Consumes: `formatDate`, `ResolvedFormatPrefs` (`~/utils/date-format`); `useDateFormatter` (`~/hooks/use-date-formatter`).
- Produces: `formatFilterSummary(query, columns, lookupData?, prefs?: ResolvedFormatPrefs)`.

- [ ] **Step 1: Write failing test.** Create `app/modules/asset-filter-presets/format-filter-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { formatFilterSummary } from "./format-filter-summary";

/**
 * Guard: a date filter chip must render the value in the user's configured
 * order (no hardcoded "en-US"). Uses a minimal date column definition.
 */
describe("formatFilterSummary — date values", () => {
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };
  // Minimal date column; adjust the shape to the real Column type when wiring.
  const columns = [{ name: "createdAt", queryKey: "createdAt", type: "date" }];

  it("renders a date filter value day-first for DD_MM_YYYY prefs", () => {
    const summary = formatFilterSummary(
      "createdAt=is:2026-04-03",
      columns as never,
      undefined,
      prefs
    );
    expect(summary).toMatch(/0?3\D+Apr\D+2026/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm webapp:test -- --run app/modules/asset-filter-presets/format-filter-summary.test.ts`.
- [ ] **Step 3: Thread prefs through the chain.** In `app/modules/asset-filter-presets/format-filter-summary.ts`, add the import:

```ts
import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";
```

Add `prefs?: ResolvedFormatPrefs` as the final param on `formatFilterSummary` (`:67`), `formatValue` (`:163`), and `formatSingleValue` (`:195`), and forward it. At `:67`:

```ts
export function formatFilterSummary(
  query: string,
  columns: Column[],
  lookupData?: FilterLookupData,
  prefs?: ResolvedFormatPrefs
): string {
```

At the `formatValue` call `:93`, append `prefs`:

```ts
const valueText = formatValue(
  filter.value,
  filter.type,
  filter.operator,
  filter.name,
  lookupData,
  prefs
);
```

At `:163`:

```ts
function formatValue(
  value: unknown,
  type: string,
  operator: string,
  fieldName: string,
  lookupData?: FilterLookupData,
  prefs?: ResolvedFormatPrefs
): string {
```

Forward `prefs` in each `formatSingleValue(...)` call inside `formatValue` (`:173`, `:178`, `:185`, `:189`) — append `prefs` as the final argument to each. At `:195`:

```ts
function formatSingleValue(
  value: unknown,
  type: string,
  fieldName: string,
  lookupData?: FilterLookupData,
  prefs?: ResolvedFormatPrefs
): string {
```

Replace the date branch at `:261-267`:

```ts
// Date values
if (type === "date" && typeof value === "string") {
  try {
    return prefs
      ? formatDate(value, prefs, {
          month: "short",
          day: "numeric",
          year: "numeric",
          localeOnly: true,
        })
      : value;
  } catch {
    return String(value);
  }
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm webapp:test -- --run app/modules/asset-filter-presets/format-filter-summary.test.ts`. (If the `Column` shape in the test needs more fields to parse, extend the fixture to satisfy `parseFilters` — the assertion stays the same.)
- [ ] **Step 5: Pass prefs from `use-filter-preview.tsx`.** Add the hook import:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Add inside `useFilterPreview` (after the `useLoaderData` destructure):

```tsx
const { prefs } = useDateFormatter();
```

Replace the `formatFilterSummary` call at `:55`:

```tsx
summary = formatFilterSummary(query, columns, lookupData, prefs);
```

and add `prefs` to the `useMemo`/`useCallback` dependency array that wraps `formatSummaryComponent`.

- [ ] **Step 6: Typecheck + manual.** `pnpm --filter @shelf/webapp typecheck` — expect no errors. Manual: on `/assets` advanced index, create/apply a filter preset containing a date filter; the preset summary chip renders the date in the user's configured order.
- [ ] **Step 7: Commit.**

```
git commit -am "feat(dates): format filter-preset date chips via user prefs

Thread ResolvedFormatPrefs through formatFilterSummary/formatValue/
formatSingleValue and pass useDateFormatter().prefs from useFilterPreview.
Drops the hardcoded en-US date chip render."
```

---

### Task 6.6: Admin trial label + working-hours time display (A12, A13)

**Files:**

- Modify: `app/routes/_layout+/admin-dashboard+/users.tsx:146` (`formatOwnerStatus` sig), `:155-158`, `:124` (call site), component body
- Modify: `app/components/shared/time-display.tsx:1,12-32`
- Test: none (component/route render — verified via typecheck + manual)

**Interfaces:**

- Consumes: `useDateFormatter` (`~/hooks/use-date-formatter`); `ResolvedFormatPrefs` (`~/utils/date-format`).
- Produces: none (leaf UI).

- [ ] **Step 1: Convert `time-display.tsx` (A13).** Replace the `useHints` import at `:1`:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Replace the `TimeDisplay` body at `:12-32`:

```tsx
export const TimeDisplay = ({ time, className }: TimeDisplayProps) => {
  const { formatTime } = useDateFormatter();

  if (!time) return null;

  try {
    // Wall-clock working-hours time (HH:MM, 24h). Render in the user's
    // configured time format WITHOUT timezone conversion (localeOnly) — the
    // value is already the workspace-local open/close time, not a UTC instant.
    const timeDate = new Date(`2000-01-01T${time}:00`);
    return (
      <span className={className}>
        {formatTime(timeDate, { localeOnly: true })}
      </span>
    );
  } catch {
    // Fallback to original time if formatting fails
    return <span className={className}>{time}</span>;
  }
};
```

- [ ] **Step 2: Convert admin trial label (A12).** In `app/routes/_layout+/admin-dashboard+/users.tsx`, add the hook import:

```tsx
import { useDateFormatter } from "~/hooks/use-date-formatter";
```

Add the `ResolvedFormatPrefs` type import alongside it:

```tsx
import type { ResolvedFormatPrefs } from "~/utils/date-format";
```

`formatOwnerStatus`/`formatMemberStatus` are module-level helpers called from the `Area51` component render (`:124`, `:135`). Give `formatOwnerStatus` a `prefs` param. Replace the signature at `:146`:

```tsx
function formatOwnerStatus(
  user: UserWithSubscription,
  prefs: ResolvedFormatPrefs
): string {
```

Replace the trial-date block at `:155-158` (uses `formatDate` from `~/utils/date-format`, imported for module-scope use). Add the value import at the top of the file:

```tsx
import { formatDate } from "~/utils/date-format";
```

```tsx
const trialEndDate = new Date(user.subscription.trial_end * 1000);
const formattedDate = formatDate(trialEndDate, prefs, {
  month: "short",
  day: "numeric",
});
return `Owner (Trial - ends ${formattedDate})`;
```

In `Area51()`, add near the top of the body:

```tsx
const { prefs } = useDateFormatter();
```

Update the `formatOwnerStatus` call at `:124`:

```tsx
return formatOwnerStatus(user, prefs);
```

- [ ] **Step 3: Typecheck.** `pnpm --filter @shelf/webapp typecheck` — expect no errors (confirms `formatOwnerStatus` now requires `prefs` at every call site, and `time-display.tsx` no longer references `useHints`).
- [ ] **Step 4: Manual verify.** Working hours: open a location / workspace working-hours preview — open/close times render in the user's configured 12h/24h format. Admin: `/admin-dashboard/users` — a trialing owner's "ends …" date renders via prefs (English month, prefs order).
- [ ] **Step 5: Commit.**

```
git commit -am "feat(dates): format working-hours time and admin trial label via prefs

TimeDisplay uses useDateFormatter().formatTime (honors 12h/24h + timeZone);
the admin users trial-end label drops hardcoded en-US and takes ResolvedFormatPrefs."
```

---

### Phase 6 exit check

- [ ] **Step 1: Full validate.** `pnpm webapp:validate` — expect lint, typecheck, and all new + existing unit tests green. Kill any lingering vitest watch process afterward.
- [ ] **Step 2: Grep sweep — confirm no client `en-US`/`"default"` date renders remain in the A-list files.** `git grep -n 'toLocaleDateString("en-US"\|toLocaleString("default"\|toLocaleDateString("default"' -- app/components app/utils app/modules app/hooks app/routes` — the only permitted remaining hits are the SERVER file handed to Phase 7 (`helpers.server.ts`) and `date-format-selector.tsx` (A14, infra preview). No new hits in the files this phase touched. (`dashboard.server.ts` builds its chart-axis month via `MONTH_NAMES[d.getMonth()]` — **not** a `toLocaleDateString` hit, so it never appears in this grep — and is annotated as a documented no-change in Task 7.7.)

---

## Phase 7: Server display sweep — route every server-side date format through `formatDate` + resolved user prefs

This phase replaces every server-side use of `getDateTimeFormat(request, …)` /
`getDateTimeFormatFromHints(hints, …)` / hardcoded `toLocaleDateString("en-US", …)`
with `formatDate(value, prefs, opts)`, where `prefs: ResolvedFormatPrefs` is resolved
via `resolveUserFormatPrefsById(userId, hints)` (server seam from Phase 2/3). The
decisive rule per site: **ACTING** user's prefs for CSV/PDF exports + the audit-PDF
note sanitizer (the person who triggered it); **RECIPIENT** user's prefs for booking,
audit and Stripe emails (the person receiving it) — resolved **inside the per-recipient
loop** by `recipient.userId`, never the shared acting-user hints. Machine-readable ISO
CSV columns and English chart-axis labels stay as-is (documented decisions).

Consumes from earlier phases (frozen contract):

- `formatDate(value: string | Date, prefs: ResolvedFormatPrefs, opts?: DateFormatOptions): string` — `~/utils/date-format`
- `HARDCODED_DEFAULT_PREFS: ResolvedFormatPrefs`, type `ResolvedFormatPrefs` — `~/utils/date-format`
- `resolveUserFormatPrefsById(userId: string, hints: ClientHint | null, tx?): Promise<ResolvedFormatPrefs>` — `~/utils/date-format.server`
- `getClientHint(request): ClientHint` — `~/utils/client-hints`

---

### Task 7.1: Refactor `sanitizeNoteContent` to take `ResolvedFormatPrefs` (TDD)

**Files:**

- Modify: `apps/webapp/app/utils/note-sanitizer.server.ts:26` (delete `createDateOnlyFormatter`), `:46`, `:119` (signature)
- Test: `apps/webapp/app/utils/note-sanitizer.server.test.ts`

**Interfaces:**

- Consumes: `formatDate`, `ResolvedFormatPrefs`, `HARDCODED_DEFAULT_PREFS`
- Produces: `sanitizeNoteContent(content: string, prefs: ResolvedFormatPrefs): string` (consumed by Tasks 7.2 and 7.3)

The `{% date value=… %}` markdoc tag currently formats via a passed `Intl.DateTimeFormat`
and a `createDateOnlyFormatter` reflection trick reading `resolvedOptions()`. Switching to
`formatDate` removes the fragile reflection: `includeTime=false` → `formatDate(d, prefs)`
(date-only default), `includeTime` truthy → `formatDate(d, prefs, { includeTime: true })`.

- [ ] **Step 1: Rewrite the test suite to assert delegation to `formatDate`.** Replace the whole file so the `Intl.DateTimeFormat` fixture and the now-obsolete `resolvedOptions` fallback test are gone. Assert against `formatDate` output so the test stays robust to the formatter's exact string shape:

```ts
import { describe, expect, it } from "vitest";

import { formatDate, HARDCODED_DEFAULT_PREFS } from "./date-format";
import { sanitizeNoteContent } from "./note-sanitizer.server";

// why: HARDCODED_DEFAULT_PREFS is the concrete fallback prefs the formatter
// consumes; using it keeps these assertions independent of any user row.
const prefs = HARDCODED_DEFAULT_PREFS;

describe("sanitizeNoteContent", () => {
  const sanitize = (content: string) => sanitizeNoteContent(content, prefs);

  it("strips markdoc link tags and decodes entities", () => {
    const content =
      '{% link to="/bookings/abc" text="Booking &quot;A&quot;" /%} updated.';

    expect(sanitize(content)).toBe('Booking "A" updated.');
  });

  it("formats markdoc date tags via formatDate, respecting includeTime", () => {
    const iso = "2023-12-25T10:30:00.000Z";
    const content = `Due {% date value="${iso}" includeTime=false /%} and scheduled {% date value="${iso}" /%}.`;

    const expectedDate = formatDate(iso, prefs);
    const expectedDateTime = formatDate(iso, prefs, { includeTime: true });

    expect(sanitize(content)).toBe(
      `Due ${expectedDate} and scheduled ${expectedDateTime}.`
    );
  });

  it("returns the raw value for an unparseable date", () => {
    expect(sanitizeNoteContent('{% date value="not-a-date" /%}', prefs)).toBe(
      "not-a-date"
    );
  });

  it("converts assets and kits markdoc tags to readable counts", () => {
    const content =
      'Removed {% assets_list count=3 ids="1,2,3" action="removed" /%} and assigned {% kits_list count=1 ids="kit" action="added" /%}.';

    expect(sanitize(content)).toBe("Removed 3 assets and assigned 1 kit.");
  });

  it("normalizes description markdoc tags", () => {
    const content =
      'Description changed {% description oldText="Old text" newText="New text" /%}.';

    expect(sanitize(content)).toBe("Description changed Old text -> New text.");
  });

  it("cleans markdown formatting while preserving line breaks", () => {
    const content = `# Heading

- one
- two

**Bold** text with [link](https://example.com) and code \`const x = 1\`.
`;

    expect(sanitize(content)).toBe(`Heading

- one
- two

Bold text with link and code const x = 1.`);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.** `sanitizeNoteContent` still takes an `Intl.DateTimeFormat`; the `formatDate` import / prefs signature don't exist yet.

```
pnpm webapp:test -- --run app/utils/note-sanitizer.server.test.ts
```

Expected: compile/type errors or assertion failures (function signature mismatch).

- [ ] **Step 3: Delete `createDateOnlyFormatter` and add the `formatDate` import.** At the top of `note-sanitizer.server.ts` add:

```ts
import { formatDate, type ResolvedFormatPrefs } from "./date-format";
```

Then delete the entire `createDateOnlyFormatter` block (`note-sanitizer.server.ts:26-44`).

- [ ] **Step 4: Rewrite `sanitizeMarkdocTags` to format via `formatDate`.** Replace the current signature + the `date` case body (`:46-81`):

```ts
const sanitizeMarkdocTags = (
  text: string,
  prefs: ResolvedFormatPrefs
): string =>
  text.replace(
    MARKDOC_TAG_REGEX,
    (_fullMatch, tagName: string, rawAttributes: string) => {
      const attrs = parseMarkdocAttributes(rawAttributes);
      switch (tagName) {
        case "link": {
          const textAttr = attrs.text ?? attrs.to ?? "";
          return decodeHtmlEntities(textAttr);
        }
        case "date": {
          const value = attrs.value;
          if (!value) return "";

          const includeTime = attrs.includeTime
            ? attrs.includeTime !== "false"
            : true;

          const parsedDate = new Date(value);
          if (Number.isNaN(parsedDate.getTime())) {
            return value;
          }

          try {
            return includeTime
              ? formatDate(parsedDate, prefs, { includeTime: true })
              : formatDate(parsedDate, prefs);
          } catch {
            return value;
          }
        }
```

Leave the remaining cases (`assets_list`, `kits_list`, `booking_status`, `description`, `default`) and the closing `}` unchanged.

- [ ] **Step 5: Update the public `sanitizeNoteContent` signature (`:119`).**

```ts
/**
 * Strips Markdoc tags from a note and formats any `{% date %}` tags with the
 * caller's resolved date/time preferences.
 *
 * @param content - Raw note content (may contain Markdoc tags + markdown)
 * @param prefs - Fully-resolved format prefs (acting user for exports/PDFs)
 * @returns Plain, human-readable text safe for CSV/PDF rendering
 */
export const sanitizeNoteContent = (
  content: string,
  prefs: ResolvedFormatPrefs
): string => {
  if (!content) return "";

  const withoutMarkdoc = sanitizeMarkdocTags(content, prefs);
  const decodedEntities = decodeHtmlEntities(withoutMarkdoc);

  return cleanMarkdownFormatting(decodedEntities, {
    preserveLineBreaks: true,
  });
};
```

- [ ] **Step 6: Run the test — expect PASS.**

```
pnpm webapp:test -- --run app/utils/note-sanitizer.server.test.ts
```

Expected: all specs green.

- [ ] **Step 7: Commit.**

```
git commit -am "refactor(notes): sanitizeNoteContent formats dates via resolved prefs

Swap the passed Intl.DateTimeFormat for ResolvedFormatPrefs and format
{% date %} tags through formatDate, removing the resolvedOptions reflection."
```

---

### Task 7.2: CSV exports — ACTING user's prefs (assets, bookings, notes)

**Files:**

- Modify: `apps/webapp/app/utils/csv.server.ts:50` (import), `:302` `exportAssetsFromIndexToCsv`, `:346` builder call, `:374` `buildCsvExportDataFromAssets`, `:401`, `:687` `exportBookingsFromIndexToCsv`, `:778` builder call, `:813` `notesToCsv`, `:826`, `:857` `exportNotesToCsv`, `:870`, `:903`, `:906/925/945/965` note wrappers, `:1107` `buildCsvExportDataFromBookings`, `:1115`
- Modify (routes, add `userId`/pass through): `apps/webapp/app/routes/_layout+/assets.export.$fileName[.csv].tsx:54`, `assets.$assetId.activity[.csv].ts:41`, `audits.$auditId.activity[.csv].ts`, `bookings.$bookingId.activity[.csv].ts`, `locations.$locationId.activity[.csv].ts`
- Test: `apps/webapp/app/utils/csv.server.test.ts:364,434,474,555`

**Interfaces:**

- Consumes: `formatDate`, `ResolvedFormatPrefs`, `HARDCODED_DEFAULT_PREFS`, `resolveUserFormatPrefsById`, `getClientHint`, `sanitizeNoteContent(content, prefs)` (Task 7.1)
- Produces: builders now take `prefs: ResolvedFormatPrefs`; top-level export fns resolve prefs from `userId` + `request`

The three humanized formatters (`csv.server.ts:401` asset reminder dates, `:870` note `createdAt`, `:1115` booking from/to + check-in dates) become `formatDate(d, prefs, { includeTime: true })` (was `{ dateStyle: "short", timeStyle: "short" }`). Prefs are resolved **once** in the top-level export fn from the acting `userId`, then threaded into the builders. **ISO/data columns at `:460,465,613,654` are NOT touched here — see Task 7.7.**

- [ ] **Step 1: Update the two builder call sites in `csv.server.test.ts` to pass `prefs`.** These builders switch from `request` to `prefs`, so the tests must too. At `:364` and `:434` replace `request: baseRequest,` with:

```ts
      prefs: HARDCODED_DEFAULT_PREFS,
```

At `:474` and `:555` replace the positional `baseRequest` argument with `HARDCODED_DEFAULT_PREFS`:

```ts
const [headers, bookingRow, assetRow] = buildCsvExportDataFromBookings(
  [booking as any],
  HARDCODED_DEFAULT_PREFS
);
```

```ts
const [, mainRow, assetRow] = buildCsvExportDataFromBookings(
  [booking as any],
  HARDCODED_DEFAULT_PREFS,
  checkinsByBooking
);
```

Add the import at the top of the test file:

```ts
import { HARDCODED_DEFAULT_PREFS } from "./date-format";
```

- [ ] **Step 2: Run the test — expect FAIL.** The builders still expect `request`; type errors on `prefs`/positional arg.

```
pnpm webapp:test -- --run app/utils/csv.server.test.ts
```

Expected: type/compile failure in `buildCsvExportDataFromAssets` / `buildCsvExportDataFromBookings`.

- [ ] **Step 3: Add imports and drop `getDateTimeFormat` in `csv.server.ts`.** At `:50` replace:

```ts
import { getDateTimeFormat } from "./client-hints";
```

with:

```ts
import { getClientHint } from "./client-hints";
import { formatDate, type ResolvedFormatPrefs } from "./date-format";
import { resolveUserFormatPrefsById } from "./date-format.server";
```

- [ ] **Step 4: Migrate the assets builder (`:374` sig, `:401` formatter).** Replace the `request: Request;` line in the `buildCsvExportDataFromAssets` param type with `prefs: ResolvedFormatPrefs;` and update its JSDoc `@param`. Then replace `:401`:

```ts
// Create date formatter for reminder dates (acting user's prefs)
const formatDateForCsv = (date: Date | string) =>
  formatDate(date, prefs, { includeTime: true });
```

Rename the two call sites that used the old `formatDate` local (search within the builder for `formatDate(` reminder usage) to `formatDateForCsv(`.

- [ ] **Step 5: Resolve prefs in `exportAssetsFromIndexToCsv` (`:302`) and pass down.** Add `userId: string;` to its param type. Before the `buildCsvExportDataFromAssets` call at `:346`, insert:

```ts
// Acting user's prefs: this export was triggered by userId, so their
// date/time preferences drive every humanized column.
const prefs = await resolveUserFormatPrefsById(userId, getClientHint(request));
```

Then in the `:346` call replace `request,` with `prefs,`.

- [ ] **Step 6: Migrate the bookings builder (`:1107` sig, `:1115` formatter).** Change the signature to:

```ts
export const buildCsvExportDataFromBookings = (
  bookings: FlexibleBooking[],
  prefs: ResolvedFormatPrefs,
  checkinsByBooking: Map<string, BookingCheckinInfo> = new Map()
): string[][] => {
```

Replace `:1115`:

```ts
// Create date formatter for CSV export (acting user's prefs)
const format = (date: Date | string) =>
  formatDate(date, prefs, { includeTime: true });
```

(The existing `format(checkinDate)` / `format(booking.from)` call sites stay unchanged.)

- [ ] **Step 7: Resolve prefs in `exportBookingsFromIndexToCsv` (`:687`) and pass down.** It already has `userId`. Before the `buildCsvExportDataFromBookings` call at `:778` insert:

```ts
const prefs = await resolveUserFormatPrefsById(userId, getClientHint(request));
```

Change the `:778` call to:

```ts
const csvData = buildCsvExportDataFromBookings(
  bookings as FlexibleBooking[],
  prefs,
  checkinsByBooking
);
```

- [ ] **Step 8: Migrate `notesToCsv` (`:813`) + `exportNotesToCsv` (`:857`).** Change `notesToCsv`'s second param and its two formatter usages:

```ts
const notesToCsv = (notes: ActivityNote[], prefs: ResolvedFormatPrefs) => {
  const rows = notes.map((note) => {
    const author = note.user
      ? [note.user.firstName, note.user.lastName]
          .filter(Boolean)
          .join(" ")
          .trim()
      : "";

    return [
      sanitizeCsvValue(
        formatDate(note.createdAt, prefs, { includeTime: true })
      ),
      sanitizeCsvValue(author),
      sanitizeCsvValue(note.type),
      sanitizeCsvValue(sanitizeNoteContent(note.content ?? "", prefs)),
    ].join(",");
  });

  return [ACTIVITY_HEADER, ...rows].join("\n");
};
```

In `exportNotesToCsv` (`:857`) add `userId: string` to `ExportNotesToCsvArgs` and its destructure, delete the `getDateTimeFormat` formatter block at `:870`, and change the final `:903` return:

```ts
async function exportNotesToCsv<Where>({
  request,
  userId,
  where,
  findMany,
}: ExportNotesToCsvArgs<Where>) {
  const prefs = await resolveUserFormatPrefsById(
    userId,
    getClientHint(request)
  );

  const notes = await findMany({
    /* unchanged include/orderBy/where */
  });

  const activityNotes = notes.map<ActivityNote>((note) => ({
    /* unchanged */
  }));

  return notesToCsv(activityNotes, prefs);
}
```

- [ ] **Step 9: Thread `userId` through the 4 note wrappers (`:906/925/945/965`).** Each `exportAssetNotesToCsv` / `exportBookingNotesToCsv` / `exportAuditNotesToCsv` / `exportLocationNotesToCsv` adds `userId: string;` to its arg type and forwards `userId,` into the `exportNotesToCsv({ request, userId, where, findMany })` call. Example (`exportAssetNotesToCsv`, `:906`):

```ts
export async function exportAssetNotesToCsv({
  request,
  userId,
  assetId,
  organizationId,
}: {
  request: Request;
  userId: string;
  assetId: string;
  organizationId: string;
}) {
  return exportNotesToCsv<Prisma.NoteWhereInput>({
    request,
    userId,
    where: { assetId, asset: { organizationId } },
    findMany: (args) => db.note.findMany(args) as Promise<ActivityNoteRecord[]>,
  });
}
```

Apply the identical `userId` addition to the other three wrappers (`exportBookingNotesToCsv:925`, `exportAuditNotesToCsv:945`, `exportLocationNotesToCsv:965`).

- [ ] **Step 10: Pass `userId` from the 5 routes.** In each route's export call add `userId,` (all already destructure `const { userId } = authSession;`):

  - `assets.export.$fileName[.csv].tsx:54` → `exportAssetsFromIndexToCsv({ …, userId })`
  - `assets.$assetId.activity[.csv].ts:41` → `exportAssetNotesToCsv({ request, userId, assetId, organizationId })`
  - `audits.$auditId.activity[.csv].ts` → `exportAuditNotesToCsv({ request, userId, auditId, organizationId })`
  - `bookings.$bookingId.activity[.csv].ts` → `exportBookingNotesToCsv({ request, userId, bookingId, organizationId })`
  - `locations.$locationId.activity[.csv].ts` → `exportLocationNotesToCsv({ request, userId, locationId, organizationId })`

- [ ] **Step 11: Run the test — expect PASS.**

```
pnpm webapp:test -- --run app/utils/csv.server.test.ts
```

Expected: all specs green (builders now consume `HARDCODED_DEFAULT_PREFS`).

- [ ] **Step 12: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. Manual check: export an asset-index CSV, a bookings CSV, and an asset activity CSV — reminder/date/note-timestamp columns render in the acting user's configured format; ISO columns unchanged.

- [ ] **Step 13: Commit.**

```
git commit -am "feat(csv): humanized CSV dates honor acting user's format prefs

Thread resolved prefs into asset/booking/note CSV builders and drop the
request-locale formatter. ISO data columns stay ISO (round-trip)."
```

---

### Task 7.3: PDF exports — ACTING user's prefs (audit, booking, reports)

**Files:**

- Modify: `apps/webapp/app/routes/api+/audits.$auditId.generate-pdf.tsx:62,70,74,82`
- Modify: `apps/webapp/app/routes/api+/bookings.$bookingId.generate-pdf.tsx:62,67-79`
- Modify: `apps/webapp/app/routes/api+/reports.$reportId.generate-pdf.tsx:122` (`resolveTimeframe`), `:161` (date formatter)

**Interfaces:**

- Consumes: `formatDate`, `resolveUserFormatPrefsById`, `getClientHint`, `sanitizeNoteContent(content, prefs)` (Task 7.1)
- Produces: none (leaf routes)

Each PDF loader already has `const { userId } = context.getSession();` and calls
`requirePermission`, so the acting user is in scope. Replace the `getDateTimeFormat`
formatter object with a resolved-prefs `formatDate` wrapper that preserves the existing
`.format(date)` call shape (so downstream `pdfMeta` assignments stay identical).

- [ ] **Step 1: Migrate the audit PDF route.** In `audits.$auditId.generate-pdf.tsx`, after `requirePermission` resolves `organizationId`, add prefs resolution and replace the formatter at `:62`:

```ts
const prefs = await resolveUserFormatPrefsById(userId, getClientHint(request));

// Preserve the existing `.format(date)` call shape used below.
const dateTimeFormat = {
  format: (date: Date) => formatDate(date, prefs, { includeTime: true }),
};
```

Then change the sanitize call at `:82`:

```ts
      content: sanitizeNoteContent(note.content || "", prefs),
```

Add imports:

```ts
import { formatDate } from "~/utils/date-format";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { getClientHint } from "~/utils/client-hints";
```

and drop the now-unused `getDateTimeFormat` import. (`pdfMeta.from`/`to` at `:70/74` keep calling `dateTimeFormat.format(...)` unchanged.)

- [ ] **Step 2: Migrate the booking PDF route.** In `bookings.$bookingId.generate-pdf.tsx` replace the `:62` formatter with the same resolved-prefs wrapper:

```ts
const prefs = await resolveUserFormatPrefsById(userId, getClientHint(request));
const dateTimeFormat = {
  format: (date: Date) => formatDate(date, prefs, { includeTime: true }),
};
```

Add the same three imports; drop `getDateTimeFormat`. The `pdfMeta.from/to/originalFrom/originalTo` assignments at `:67-79` (all `dateTimeFormat.format(new Date(...))`) stay unchanged.

- [ ] **Step 3: Migrate the reports PDF route.** In `reports.$reportId.generate-pdf.tsx`, `resolveTimeframe` runs at `:122` — **before** the `:161` formatter — so resolve `prefs` **once, right after `requirePermission` returns `organizationId`** (before the filter parsing at `:116`) and reuse the same value for both the timeframe label and the date formatter. Keep `getLocale(request)` at `:150` for currency (do NOT touch it).

Resolve prefs once, immediately after `requirePermission`:

```ts
// Acting user's resolved prefs drive both the timeframe label ordering and the
// PDF table date formatter below (resolved once, reused twice).
const prefs = await resolveUserFormatPrefsById(userId, getClientHint(request));
```

Then pass `prefs` as the 4th arg to `resolveTimeframe` at `:122`:

```ts
// before
const timeframe = resolveTimeframe(
  timeframePreset,
  customFrom ? new Date(customFrom) : undefined,
  customTo ? new Date(customTo) : undefined
);

// after
const timeframe = resolveTimeframe(
  timeframePreset,
  customFrom ? new Date(customFrom) : undefined,
  customTo ? new Date(customTo) : undefined,
  prefs
);
```

Replace the `:161` `getDateTimeFormat` formatter with a `formatDate` wrapper that reuses the same
`prefs` (do **not** resolve prefs a second time):

```ts
// Report tables use a date-only label (year + short month + day). formatDate
// reassembles per the user's date-order preference.
const dateFormat = {
  format: (date: Date) =>
    formatDate(date, prefs, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
};
```

Add `formatDate` / `resolveUserFormatPrefsById` / `getClientHint` imports; drop the `getDateTimeFormat` import. All `dateFormat.format(...)` call sites (`:191,193,194,219,220,258,300,311`) remain unchanged.

- [ ] **Step 4: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. Manual check: generate an audit PDF (session dates + note dates honor the acting user's prefs), a booking PDF (from/to/original dates), and a report PDF (both the timeframe-label header and the table date rows honor the acting user's prefs).

- [ ] **Step 5: Commit.**

```
git commit -am "feat(pdf): audit/booking/report PDFs honor acting user's format prefs

Replace request-locale formatters with resolved-prefs formatDate wrappers;
audit PDF note sanitizer now receives resolved prefs."
```

---

### Task 7.4: Booking emails — RECIPIENT user's prefs (helpers, template, fan-out, worker)

**Files:**

- Modify: `apps/webapp/app/modules/booking/email-helpers.ts:14` (`hints`→`prefs`), `:30`, `:41`, `:45`, `:250`, `:252`
- Modify: `apps/webapp/app/emails/bookings-updates-template.tsx:13` (import), `:83`, `:87` (+ `Props` `hints`→`prefs`)
- Modify: `apps/webapp/app/modules/booking/service.server.ts:160` (chokepoint), `:1201` (`formatDateForEmail`), `:8459/:8476` (extend), and 6 more `sendBookingEmailToAllRecipients` call sites (`:1773,:4794,:8118,:9625,:10451,:10873`)
- Modify: `apps/webapp/app/modules/booking/worker.server.ts:66-90` (checkout reminder loop), `:203-224` (overdue loop)
- Modify: `apps/webapp/app/modules/booking/notification-recipients.server.ts:59` (extend `NotificationRecipient` + its five source `select` clauses with the four raw pref fields, so recipient prefs resolve from the loaded row — no per-recipient DB fetch)

**Interfaces:**

- Consumes: `formatDate`, `ResolvedFormatPrefs`, `resolveFormatPrefs` (pure), `resolveUserFormatPrefsById` (change-list only), and the raw pref fields now on `NotificationRecipient` (`notification-recipients.server.ts:59`)
- Produces: `sendBookingEmailToAllRecipients` takes `buildText`/`buildHeading` callbacks + `hints` (fallback); `*EmailContent` helpers + template take `prefs`

**Design decision (state in commit):** the single acting-user `hints` threaded through the
fan-out is replaced by **per-recipient prefs resolved from the already-loaded recipient row** via
the pure `resolveFormatPrefs(recipient, hints)` (with `hints` as the null-field fallback). Because
`getBookingNotificationRecipients` already fetches each recipient, extending its `select` with the
four pref columns lets prefs resolve **with no extra DB round-trip** — this avoids an N+1 in the
send loop. The from/to dates, heading, and template dates honor the recipient. The embedded
`changes[]` diff list (`formatDateForEmail`, `:1201`) is a **documented acting-user compromise** —
rebuilding the whole diff per recipient is disproportionate; it uses the editor's resolved prefs
(resolved once via `resolveUserFormatPrefsById`, the only remaining per-userId fetch in this task).

- [ ] **Step 1: Swap `hints`→`prefs` in `baseBookingTextEmailContent` (`email-helpers.ts:14`).** Change the shared arg type and both formatters:

```ts
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { formatDate } from "~/utils/date-format";

type BasicEmailContentArgs = {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  prefs: ResolvedFormatPrefs;
  customEmailFooter?: string | null;
};
```

Replace the `fromDate`/`toDate` block (`:41-49`):

```ts
const fromDate = formatDate(from, prefs, { includeTime: true });
const toDate = formatDate(to, prefs, { includeTime: true });
```

Remove the `getDateTimeFormatFromHints` / `ClientHint` imports if now unused in this file (after Step 2). Every `*EmailContent` builder that spreads `...args` (`cancelledBookingEmailContent`, `bookingUpdatedEmailContent`, `completedBookingEmailContent`, `deletedBookingEmailContent`, `overdueBookingEmailContent`, etc.) inherits `prefs` automatically — no per-builder change except `extendBookingEmailContent`.

- [ ] **Step 2: Migrate `extendBookingEmailContent` (`email-helpers.ts:250`).** Replace its formatter:

```ts
export function extendBookingEmailContent({
  oldToDate,
  ...args
}: BasicEmailContentArgs & { oldToDate: Date }) {
  const format = (date: Date) =>
    formatDate(date, args.prefs, { includeTime: true });

  return baseBookingTextEmailContent({
    ...args,
    emailContent: `You booking has been extended from ${format(
      oldToDate
    )} to ${format(args.to)}`,
  });
}
```

- [ ] **Step 3: Migrate the HTML template (`bookings-updates-template.tsx:83/87`).** In `Props`, change `hints: ClientHint` to `prefs: ResolvedFormatPrefs`; update the import at `:13` to `import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";` and drop `getDateTimeFormatFromHints`/`ClientHint`. Replace `:83-91`:

```ts
const fromDate = formatDate(booking.from as Date, prefs, {
  includeTime: true,
});
const toDate = formatDate(booking.to as Date, prefs, {
  includeTime: true,
});
```

Update `bookingUpdatesTemplateString` (the `render`-wrapper export in the same file) to accept `prefs` instead of `hints` and forward it to the component.

- [ ] **Step 4a: Carry the four raw pref fields on `NotificationRecipient` (`notification-recipients.server.ts:59`).** So the fan-out can resolve prefs from the loaded row (no per-recipient fetch), add the four raw pref fields to the type and to each `recipients.set(...)` object:

```ts
export type NotificationRecipient = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  userId: string;
  // Raw (nullable) format prefs, carried so the send loop can resolve prefs
  // from this already-loaded row via resolveFormatPrefs — avoids an N+1.
  dateFormat: DateFormatPreference | null;
  timeFormat: TimeFormatPreference | null;
  weekStart: WeekStartPreference | null;
  timeZone: string | null;
  reason:
    | "custodian"
    | "creator"
    | "admin"
    | "always_notify"
    | "booking_recipient";
};
```

Extend the **five** source `select`s that feed the recipient map — `booking.custodianUser`,
`booking.creator`, the admins query (`getOrganizationAdminsForNotification`),
`settings.alwaysNotifyTeamMembers[].user`, and `booking.notificationRecipients[].user` — to include
`dateFormat, timeFormat, weekStart, timeZone`, and spread those onto each `recipients.set(...)`
object (e.g. `dateFormat: booking.custodianUser.dateFormat`, …). Import the three enum types from
`@prisma/client`.

- [ ] **Step 4b: Rework the chokepoint `sendBookingEmailToAllRecipients` (`service.server.ts:160`).** Replace the static `textContent`/`heading` params with per-recipient builders and resolve prefs **from the loaded recipient row** inside the loop (pure resolver — no `await`, no DB fetch):

```ts
async function sendBookingEmailToAllRecipients({
  recipients,
  booking,
  subject,
  buildText,
  buildHeading,
  hints,
  templateProps,
}: {
  recipients: NotificationRecipient[];
  booking: BookingForEmail;
  subject: string;
  /** Built per recipient with their resolved prefs. */
  buildText: (prefs: ResolvedFormatPrefs) => string;
  /** Built per recipient with their resolved prefs. */
  buildHeading: (prefs: ResolvedFormatPrefs) => string;
  /** Acting user's hints — only the null-field fallback for recipients. */
  hints: ClientHint;
  templateProps?: {
    hideViewButton?: boolean;
    cancellationReason?: string;
    changes?: string[];
    assets?: ReservationEmailAsset[];
    modelRequests?: ReservationEmailModelRequest[];
  };
}) {
  for (const recipient of recipients) {
    // Recipient prefs resolved from the ALREADY-LOADED row (raw pref fields on
    // NotificationRecipient); hints is the null-field fallback only. Pure —
    // no per-recipient DB fetch (avoids an N+1 in the fan-out).
    const recipientPrefs = resolveFormatPrefs(recipient, hints);
    const html = await bookingUpdatesTemplateString({
      booking,
      heading: buildHeading(recipientPrefs),
      assetCount: booking._count.bookingAssets,
      prefs: recipientPrefs,
      recipientReason: recipient.reason,
      recipientEmail: recipient.email,
      ...templateProps,
    });

    sendEmail({
      to: recipient.email,
      subject,
      text: buildText(recipientPrefs),
      html,
    });
  }
}
```

Add imports at the top of `service.server.ts`: `import { formatDate, resolveFormatPrefs, type ResolvedFormatPrefs } from "~/utils/date-format";` and `import { resolveUserFormatPrefsById } from "~/utils/date-format.server";` (the latter is still used by the acting-user change list in Step 5). `resolveFormatPrefs` accepts the `recipient` row directly — `NotificationRecipient` structurally supplies the four raw pref fields `RawFormatPrefs` needs.

- [ ] **Step 5: Migrate `formatDateForEmail` (`service.server.ts:1201`) to acting-user prefs.** This builds the `changes[]` diff once (editor = `userId`, resolved at `:1183`). Replace `:1198-1207`:

```ts
// Acting-user compromise: the embedded change list uses the editor's
// resolved prefs (rebuilding the diff per recipient is disproportionate).
const actingPrefs = userId
  ? await resolveUserFormatPrefsById(userId, hints)
  : null;

// Helper to format dates for email change descriptions
const formatDateForEmail = (date: Date) =>
  actingPrefs
    ? formatDate(date, actingPrefs, { includeTime: true })
    : date.toISOString();
```

- [ ] **Step 6: Migrate the extend-email call site (`service.server.ts:8459-8482`).** The `text` and `heading` become builders; the date-only heading uses recipient prefs:

```ts
const custodian = updatedBooking?.custodianUser
  ? resolveUserDisplayName(updatedBooking.custodianUser)
  : updatedBooking.custodianTeamMember?.name ?? "";

await sendBookingEmailToAllRecipients({
  recipients,
  booking: updatedBooking,
  subject: `Booking extended (${updatedBooking.name}) - shelf.nu`,
  buildText: (prefs) =>
    extendBookingEmailContent({
      bookingName: updatedBooking.name,
      assetsCount: updatedBooking._count.bookingAssets,
      custodian,
      from: updatedBooking.from!,
      to: updatedBooking.to!,
      prefs,
      bookingId: updatedBooking.id,
      oldToDate: booking.to,
      customEmailFooter: updatedBooking.organization.customEmailFooter,
    }),
  buildHeading: (prefs) =>
    `Booking extended from ${formatDate(booking.to, prefs, {
      includeTime: true,
    })} to ${formatDate(newEndDate, prefs, { includeTime: true })}`,
  hints,
});
```

Delete the now-removed `const text = extendBookingEmailContent({…})` and `const { format } = getDateTimeFormatFromHints(…)` lines above it.

- [ ] **Step 7: Migrate the remaining 6 `sendBookingEmailToAllRecipients` call sites.** Each currently does `const text = <Xxx>BookingEmailContent({ …, hints });` then passes `textContent: text, heading: <static string>, hints`. Apply the identical transform at each: delete the `const text = …` line, and pass `buildText`/`buildHeading` callbacks. Concrete per site (all keep their existing static `heading` string as a constant returned by `buildHeading`):

| Line     | Builder used                                       | Transform                                                                                                                              |
| -------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `:1773`  | reservation template (uses `templateProps.assets`) | `buildText: (prefs) => <existing text builder>({ …, prefs })`, `buildHeading: () => <existing heading>`, keep `templateProps`, `hints` |
| `:4794`  | `completedBookingEmailContent` (built `:4783`)     | same — move the `:4783` args into `buildText: (prefs) => completedBookingEmailContent({ …, prefs })`                                   |
| `:8118`  | `cancelledBookingEmailContent` (built `:8106`)     | move `:8106` args into `buildText: (prefs) => cancelledBookingEmailContent({ …, prefs })`                                              |
| `:9625`  | `deletedBookingEmailContent` (built `:9614`)       | move `:9614` args into `buildText: (prefs) => deletedBookingEmailContent({ …, prefs })`                                                |
| `:10451` | `deletedBookingEmailContent` (built `:10441`)      | same pattern                                                                                                                           |
| `:10873` | `cancelledBookingEmailContent` (built `:10862`)    | same pattern                                                                                                                           |

For each: (a) delete the standalone `const text = …({ …, hints })`; (b) in the `sendBookingEmailToAllRecipients({ … })` object replace `textContent: text,` with `buildText: (prefs) => <sameBuilder>({ …same args…, prefs }),`; (c) replace `heading: <expr>,` with `buildHeading: () => <expr>,`; (d) leave `hints` and any `templateProps` in place. Representative (`:4783/:4794`, completed):

```ts
await sendBookingEmailToAllRecipients({
  recipients,
  booking: updatedBooking,
  subject: `Booking completed (${updatedBooking.name}) - shelf.nu`,
  buildText: (prefs) =>
    completedBookingEmailContent({
      bookingName: updatedBooking.name,
      assetsCount: updatedBooking._count.bookingAssets,
      custodian,
      from: updatedBooking.from!,
      to: updatedBooking.to!,
      prefs,
      bookingId: updatedBooking.id,
      customEmailFooter: updatedBooking.organization.customEmailFooter,
    }),
  buildHeading: () => `Booking completed: "${updatedBooking.name}"`,
  hints,
});
```

(Use each call site's existing subject/heading string verbatim; only `hints`→`prefs` inside the builder args changes.)

- [ ] **Step 8: Migrate the worker's two per-recipient loops (`worker.server.ts`).** The worker owns its own loops (not the chokepoint) and passes `data.hints`. Its `recipients` come from `getBookingNotificationRecipients` too, so each row already carries the four raw pref fields (Step 4a) — resolve prefs from the loaded row with the pure `resolveFormatPrefs` (no per-recipient DB fetch). Move text-building inside the loop. Checkout reminder (`:66-90`):

```ts
      for (const recipient of recipients) {
        // Pure resolve from the loaded recipient row; hints as null-field
        // fallback only. No per-recipient DB fetch (avoids an N+1).
        const recipientPrefs = resolveFormatPrefs(recipient, data.hints);
        const html = await bookingUpdatesTemplateString({
          booking,
          heading: /* existing heading string */,
          assetCount: booking._count.bookingAssets,
          prefs: recipientPrefs,
          recipientReason: recipient.reason,
          recipientEmail: recipient.email,
        });
        sendEmail({
          to: recipient.email,
          subject,
          text: checkoutReminderEmailContent({
            /* existing args */
            prefs: recipientPrefs,
          }),
          html,
        });
      }
```

Apply the same shape to the overdue loop (`:203-224`), building `text` via `overdueBookingEmailContent({ …, prefs: recipientPrefs })` inside the loop and passing `prefs: recipientPrefs` to `bookingUpdatesTemplateString`. Delete the pre-loop `const text = …` in both. Add the `resolveFormatPrefs` import (`~/utils/date-format` — the worker resolves from the loaded row and doesn't call `formatDate`/`resolveUserFormatPrefsById` directly). Update `worker.server.test.ts:71` mock if the `overdueBookingEmailContent` arg shape assertion breaks.

- [ ] **Step 9: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors across `service.server.ts`, `email-helpers.ts`, `worker.server.ts`, template.

- [ ] **Step 10: Run booking service + worker tests — expect PASS.**

```
pnpm webapp:test -- --run app/modules/booking/service.server.test.ts app/modules/booking/worker.server.test.ts
```

Expected: green (adjust any mock arg-shape expectations that referenced `hints`).

- [ ] **Step 11: Commit.**

```
git commit -am "feat(booking-email): recipient-specific date/time formatting

Resolve recipient prefs from the already-loaded recipient row (raw pref fields
added to NotificationRecipient) via the pure resolveFormatPrefs in the fan-out
and worker loops — no per-recipient DB fetch (avoids an N+1). Templates + text
helpers take prefs. Embedded change-list stays acting-user."
```

---

### Task 7.5: Audit emails — RECIPIENT user's prefs (helpers, template, assign plumbing)

**Files:**

- Modify: `apps/webapp/app/modules/audit/email-helpers.ts:4-5` (imports), `:10` (`hints`→`prefs`), `:40`, `:104`, `:110`, `:159` `sendAuditAssignedEmail` (+ `assigneeUserId`), `:244-251`/`:327` (extend `assigneesToNotify[].user` typed shape with the four raw pref fields), `:254` `sendAuditCancelledEmails` loop, `:319` `sendAuditCompletedEmail` loop, `sendAuditReminderEmail` loop
- Modify: `apps/webapp/app/emails/audit-updates-template.tsx:8-9` (imports), `:72`, `:128` (+ `Props` `hints`→`prefs`)
- Modify: `apps/webapp/app/routes/api+/audits.start.ts:260` (pass `assigneeUserId`)
- Modify: the audit service that builds `assigneesToNotify` — extend its assignee `user` `select` with `dateFormat, timeFormat, weekStart, timeZone` so bulk-loop prefs resolve from the loaded row

**Interfaces:**

- Consumes: `formatDate`, `ResolvedFormatPrefs`, `resolveFormatPrefs` (bulk loops — loaded row), `resolveUserFormatPrefsById` (singular `sendAuditAssignedEmail` — userId only)
- Produces: audit text helpers + `AuditUpdatesEmailTemplate` take `prefs`; `sendAuditAssignedEmail` gains `assigneeUserId`

The bulk senders (`sendAuditCancelledEmails`, `sendAuditCompletedEmail`,
`sendAuditReminderEmail`) already `forEach(assignment)` over rows that carry `assignment.user`, so —
once the assignee `select` includes the four pref fields — prefs resolve from the **loaded row** via
the pure `resolveFormatPrefs(assignment.user, hints)` with **no per-recipient DB fetch** (avoids an
N+1 in the bulk fan-out). The singular `sendAuditAssignedEmail` (`:159`) receives only
`assigneeEmail`/`assigneeName` and no assignee row — plumb the assignee `userId` from its caller and
resolve with a single `resolveUserFormatPrefsById` (one email, one fetch — acceptable).

- [ ] **Step 1: Swap `hints`→`prefs` in `baseAuditTextEmailContent` + completion helper.** In `email-helpers.ts` change `BasicAuditEmailContentArgs.hints: ClientHint` to `prefs: ResolvedFormatPrefs`, add `import { formatDate, resolveFormatPrefs, type ResolvedFormatPrefs } from "~/utils/date-format";` (`resolveFormatPrefs` is used by the bulk loops) and `import { resolveUserFormatPrefsById } from "~/utils/date-format.server";` (singular assign path), and drop `getDateTimeFormatFromHints`/`ClientHint` where unused. Replace the `dueDateText` at `:40`:

```ts
const dueDateText = dueDate
  ? `Due date: ${formatDate(dueDate, prefs, { includeTime: true })}\n`
  : "";
```

In `auditCompletedEmailContent` replace `:104` and `:110`:

```ts
const completedDateText = formatDate(args.completedAt, args.prefs, {
  includeTime: true,
});

const dueDateText = args.dueDate
  ? formatDate(args.dueDate, args.prefs, { includeTime: true })
  : null;
```

- [ ] **Step 2: Migrate the HTML template (`audit-updates-template.tsx:72/128`).** Change `Props.hints` to `prefs: ResolvedFormatPrefs`; imports at `:8-9` → `import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";`. Replace `:66-73`:

```ts
const dueDateFormatted = audit.dueDate
  ? formatDate(audit.dueDate as Date, prefs, { includeTime: true })
  : null;
```

and the completed-on formatter at `:128`:

```ts
{
  formatDate(completedAt, prefs, { includeTime: true });
}
```

Update `auditUpdatesTemplateString` to accept `prefs` instead of `hints` and forward it.

- [ ] **Step 3: Plumb `assigneeUserId` into `sendAuditAssignedEmail` (`:159`).** Add `assigneeUserId: string;` to its params and resolve recipient prefs before building the email:

```ts
export async function sendAuditAssignedEmail({
  audit,
  assigneeEmail,
  assigneeName,
  assigneeUserId,
  hints,
}: {
  audit: AuditForEmail;
  assigneeEmail: string;
  assigneeName: string;
  assigneeUserId: string;
  hints: ClientHint;
}) {
  const creatorName = resolveUserDisplayName(audit.createdBy);
  const assetCount = audit._count.assets;
  const prefs = await resolveUserFormatPrefsById(assigneeUserId, hints);

  try {
    const html = await auditUpdatesTemplateString({
      audit,
      heading: `🔍 You've been assigned to audit: "${audit.name}"`,
      prefs,
      assetCount,
    });

    sendEmail({
      to: assigneeEmail,
      subject: `🔍 You've been assigned to audit: "${audit.name}" - shelf.nu`,
      text: auditAssignedEmailContent({
        auditName: audit.name,
        assetsCount: assetCount,
        creatorName,
        description: audit.description,
        dueDate: audit.dueDate,
        prefs,
        auditId: audit.id,
        customEmailFooter: audit.organization.customEmailFooter,
      }),
      html,
    });
    /* unchanged Logger.info + catch */
```

(Keep `hints: ClientHint` as the fallback param passed to `resolveUserFormatPrefsById`.)

- [ ] **Step 4: Pass `assigneeUserId` from the caller (`audits.start.ts:260`).** The assignee's user row is `assigneeUser` (matched by `a.userId === assignee`). Add:

```ts
void sendAuditAssignedEmail({
  audit: auditForEmail,
  assigneeEmail: assigneeUser.user.email,
  assigneeName,
  assigneeUserId: assignee,
  hints,
});
```

- [ ] **Step 5: Resolve recipient prefs inside the 3 bulk loops — from the loaded row.** First extend the `assigneesToNotify[].user` typed shape (`:244-251`, `:327`, …) with the four raw pref fields and select them in the caller's assignee query (see the last Files entry), so no per-recipient fetch is needed. In `sendAuditCancelledEmails` (`:254`), `sendAuditCompletedEmail` (`:319`), and `sendAuditReminderEmail`, each `assigneesToNotify.forEach(async (assignment) => { … })` gains, as its first line inside the `try`, a **pure** resolve from the loaded row (no `await`, no DB fetch → avoids an N+1 in the bulk fan-out):

```ts
// Pure resolve from the already-loaded assignee row; hints is the null-field
// fallback only. resolveFormatPrefs reads the four raw pref fields off user.
const prefs = resolveFormatPrefs(assignment.user, hints);
```

Then replace `hints,` with `prefs,` in both the `auditUpdatesTemplateString({ … })` call and the `audit<Cancelled|Completed|Reminder>EmailContent({ … })` call within that loop. Example (`sendAuditCancelledEmails`):

```ts
      const html = await auditUpdatesTemplateString({
        audit,
        heading: `❌ Audit cancelled: "${audit.name}"`,
        prefs,
        assetCount,
      });

      sendEmail({
        to: assignment.user.email,
        subject: `❌ Audit cancelled: "${audit.name}" - shelf.nu`,
        text: auditCancelledEmailContent({
          auditName: audit.name,
          assetsCount: assetCount,
          creatorName,
          cancelledByName,
          description: audit.description,
          dueDate: audit.dueDate,
          prefs,
          auditId: audit.id,
          customEmailFooter: audit.organization.customEmailFooter,
        }),
        /* unchanged html + catch */
```

- [ ] **Step 6: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. If `audit/service.server.test.ts` asserts email-fn call args, update those expectations to `prefs`/`assigneeUserId`.

- [ ] **Step 7: Run audit service tests — expect PASS.**

```
pnpm webapp:test -- --run app/modules/audit/service.server.test.ts
```

Expected: green.

- [ ] **Step 8: Commit.**

```
git commit -am "feat(audit-email): recipient-specific date/time formatting

Resolve prefs from the loaded assignee row (pure resolveFormatPrefs) in the bulk
loops — no per-recipient DB fetch (avoids an N+1); plumb assigneeUserId into the
singular sendAuditAssignedEmail (one fetch). Template + text helpers take prefs."
```

---

### Task 7.6: Stripe trial + invoice emails — RECIPIENT (billed) user's prefs

**Files:**

- Modify: `apps/webapp/app/emails/stripe/trial-ends-soon.tsx:26` (wrapper), `:79`, `:125`
- Modify: `apps/webapp/app/emails/stripe/audit-trial-ends-soon.tsx:74,120`, `audit-trial-ends-tomorrow.tsx:74,118`, `barcode-trial-ends-soon.tsx:74,120`, `barcode-trial-ends-tomorrow.tsx:74,118`
- Modify: `apps/webapp/app/utils/stripe.server.ts:803` (`getInvoiceNotificationData`)
- Modify (callers resolve prefs): `apps/webapp/app/modules/stripe-webhook/handlers.server.ts:580,792,936`, `apps/webapp/app/modules/addon-trial/worker.server.ts:50,57`

**Interfaces:**

- Consumes: `formatDate`, `ResolvedFormatPrefs`, `HARDCODED_DEFAULT_PREFS`, `resolveUserFormatPrefsById`
- Produces: trial send-wrappers + `getInvoiceNotificationData` take `prefs: ResolvedFormatPrefs`

These currently hardcode `toLocaleDateString("en-US", { month:"long", day:"numeric",
year:"numeric" })`, ignoring even browser locale. Add a `prefs` prop threaded from the
handler/job (billed user's `userId` in scope). **Raw Stripe email addresses with no user
row → `HARDCODED_DEFAULT_PREFS`** (the due date is formatted once per email, not per
address; when the billed user has no row, default prefs apply).

- [ ] **Step 1: Add `prefs` to `sendTrialEndsSoonEmail` + its text/template (`trial-ends-soon.tsx`).** Add `prefs: ResolvedFormatPrefs` to `TrialEndsSoonProps` and thread it into `trialEndsSoonEmailHtml` / `trialEndsSoonEmailText`. In each, replace the `dateStr` (`:79` text, `:125` HTML):

```ts
const dateStr = formatDate(trialEndDate, prefs, {
  month: "long",
  day: "numeric",
  year: "numeric",
});
```

Add `import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";`. Add `prefs` to the two sub-builders' prop types + the wrapper's `trialEndsSoonEmailHtml({ …, prefs })` / `trialEndsSoonEmailText({ …, prefs })` calls.

- [ ] **Step 2: Apply the identical `prefs` change to the 4 addon templates.** In `audit-trial-ends-soon.tsx`, `audit-trial-ends-tomorrow.tsx`, `barcode-trial-ends-soon.tsx`, `barcode-trial-ends-tomorrow.tsx`: add `prefs: ResolvedFormatPrefs` to the send-wrapper props + the text/template sub-builders, add the `formatDate` import, and replace both `toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" })` occurrences (text + HTML) with:

```ts
const dateStr = formatDate(trialEndDate, prefs, {
  month: "long",
  day: "numeric",
  year: "numeric",
});
```

- [ ] **Step 3: Resolve prefs in the "trial ends soon" handler (`handlers.server.ts`).** The `user` object (with `user.id`) is in scope. Just before the `sendTrialEndsSoonEmail`/`sendAuditTrialEndsSoonEmail`/`sendBarcodeTrialEndsSoonEmail` calls (`:882,:888,:936`), resolve once and pass down:

```ts
const prefs = await resolveUserFormatPrefsById(user.id, null);
```

Add `prefs,` to each of those `send…Email({ … })` calls. Add imports `import { resolveUserFormatPrefsById } from "~/utils/date-format.server";`.

- [ ] **Step 4: Resolve prefs in the "trial ends tomorrow" job (`addon-trial/worker.server.ts`).** The job `data` carries `userId`. Before the `send…TomorrowEmail` calls (`:50/:57`) add:

```ts
const prefs = await resolveUserFormatPrefsById(userId, null);
```

and pass `prefs,` into both calls. Add the `resolveUserFormatPrefsById` import.

- [ ] **Step 5: Migrate `getInvoiceNotificationData` (`stripe.server.ts:782`).** Add `prefs: ResolvedFormatPrefs` to its args and format the due date with it (`:803`):

```ts
const dueDate = invoice.due_date
  ? formatDate(new Date(invoice.due_date * 1000), prefs, {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  : null;
```

Add `import { formatDate, type ResolvedFormatPrefs } from "./date-format";`.

- [ ] **Step 6: Resolve invoice prefs at both callers (`handlers.server.ts:580,:792`).** Both have the billed `user` in scope. Before each `getInvoiceNotificationData({ … })` call add:

```ts
const prefs = await resolveUserFormatPrefsById(user.id, null);
```

and pass `prefs,` into the call. (If a caller cannot prove a user row, pass `HARDCODED_DEFAULT_PREFS` instead — but here `user.id` is available.)

- [ ] **Step 7: Typecheck + run the stripe email tests.**

```
pnpm --filter @shelf/webapp typecheck
pnpm webapp:test -- --run app/emails/stripe/trial-ends-soon.test.tsx app/emails/stripe/audit-trial-ends-soon.test.tsx app/emails/stripe/audit-trial-ends-tomorrow.test.tsx app/emails/stripe/barcode-trial-ends-soon.test.tsx app/emails/stripe/barcode-trial-ends-tomorrow.test.tsx
```

Expected: no type errors; tests green after adding a `prefs: HARDCODED_DEFAULT_PREFS` prop to each template render in the specs (import it from `~/utils/date-format`).

- [ ] **Step 8: Commit.**

```
git commit -am "feat(stripe-email): trial + invoice dates honor billed user's prefs

Thread resolved prefs into 5 trial templates and getInvoiceNotificationData;
raw Stripe addresses with no user row fall back to default prefs."
```

---

### Task 7.7: Documented no-change decisions — ISO CSV data columns + report chart-axis labels

**Files:**

- Modify (comments only): `apps/webapp/app/utils/csv.server.ts:460,465,613,654`
- Modify (comments only): `apps/webapp/app/modules/reports/helpers.server.ts:775,784,790,3330`
- Modify (comments only): `apps/webapp/app/utils/dashboard.server.ts:80` (`month: MONTH_NAMES[d.getMonth()]`)

**Interfaces:**

- Consumes: none
- Produces: none (documentation-only)

Two categories are **deliberately left in their current machine/label form**. This task
only adds `// why:` anchor comments so a future reader doesn't "fix" them into pref-aware
formatting and break round-trip / axis compactness. No behavior change.

- [ ] **Step 1: Annotate the ISO CSV data columns (§4).** These are re-import round-trip columns, not display — keeping ISO is consistent with the `valuation` "lossless round-trip" comment already in the same file. Add above `csv.server.ts:460` (asset `createdAt`), `:465` (`updatedAt`), `:613` (generic `Date` in `formatValueForCsv`), and `:654` (custom-field DATE `yyyy-MM-dd`):

```ts
// why: data/export column — ISO stays ISO so export → re-import is lossless.
// Humanized display columns (reminder/timestamp) honor user prefs; these do not.
```

Confirm these four lines are unchanged in behavior (still emit ISO / `yyyy-MM-dd`).

- [ ] **Step 2: Annotate the report chart-axis labels (§B2).** `formatDayLabel` (`:775`), `formatWeekLabel` (`:784,:790`) and the monthly trend label (`:3330`) produce compact English axis labels ("Mon 21", "Mar 3-9", "Jul 2026"). Reordering these per `dateFormat` would break the compact "Weekday Day" / "Mon D-D" format, so they stay English abbreviations. Add above `helpers.server.ts:774` (`formatDayLabel`), `:782` (`formatWeekLabel`), and `:3329` (monthly label):

```ts
// why: chart-axis label, not a user-facing timestamp — compact English
// month/day abbreviations are intentional; date-order prefs don't apply here.
```

The dashboard asset-creation chart uses the same pattern: `dashboard.server.ts:80` builds
`month: MONTH_NAMES[d.getMonth()]` for a 12-month bar-chart axis. Same rationale as the
`helpers.server.ts` axis labels above — it is a compact English chart-axis month label, not a
user-facing timestamp, so it is kept as-is. Add above `dashboard.server.ts:80`:

```ts
// why: chart-axis label, not a user-facing timestamp — compact English month
// abbreviation is intentional; date-order prefs don't apply here.
```

- [ ] **Step 3: Typecheck (comments must not break the build).**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors.

- [ ] **Step 4: Full validation.**

```
pnpm webapp:validate
```

Expected: lint + typecheck + all tests pass. Kill any lingering vitest watch process afterward.
(One reports-timeframe follow-up remains — Task 7.8 — which re-runs typecheck before the phase closes.)

- [ ] **Step 5: Commit.**

```
git commit -am "docs(dates): annotate ISO CSV columns + report axis labels as intentional

No behavior change: mark data-export ISO columns and compact English chart-axis
labels as deliberately exempt from user date-format prefs."
```

---

### Task 7.8: Reports timeframe label — acting-user prefs (report page loader + CSV export)

**Files:**

- Modify: `apps/webapp/app/routes/_layout+/reports.$reportId.tsx:115-120` (add prefs resolution), `:129` (`resolveTimeframe` 4th arg), imports
- Modify: `apps/webapp/app/routes/_layout+/reports.export.$fileName[.csv].tsx:58-63` (add prefs resolution), `:103` (`resolveTimeframe` 4th arg), imports

**Interfaces:**

- Consumes: `resolveTimeframe(preset, from?, to?, prefs?)` (Task 6.4, optional 4th arg defaulting to `HARDCODED_DEFAULT_PREFS`), `resolveUserFormatPrefsById` (`~/utils/date-format.server`), `getClientHint` (`~/utils/client-hints`)
- Produces: none (leaf loaders)

Task 6.4 made `prefs` an OPTIONAL last param on `resolveTimeframe` (defaulting to
`HARDCODED_DEFAULT_PREFS`) and deferred the SERVER call sites to Phase 7. The PDF site is folded into
Task 7.3 Step 3; this task threads the acting user's resolved prefs into the **remaining two server
callers** — the report page loader and the CSV export route — so the timeframe label (custom-range +
month labels) renders in the acting user's date order, matching the client picker. Both loaders
already have `const { userId } = authSession;` and call `requirePermission`, so the acting user is in
scope.

- [ ] **Step 1: Report page loader (`reports.$reportId.tsx`).** Resolve prefs right after `requirePermission` and pass them as the 4th arg to `resolveTimeframe` at `:129`:

```ts
// before
const { organizationId } = await requirePermission({
  userId,
  request,
  entity: PermissionEntity.asset,
  action: PermissionAction.read,
});

// Parse search params for filters
const url = new URL(request.url);
const timeframePreset =
  (url.searchParams.get("timeframe") as TimeframePreset) || "last_30d";
const customFrom = url.searchParams.get("from");
const customTo = url.searchParams.get("to");

const timeframe = resolveTimeframe(
  timeframePreset,
  customFrom ? new Date(customFrom) : undefined,
  customTo ? new Date(customTo) : undefined
);
```

```ts
// after
const { organizationId } = await requirePermission({
  userId,
  request,
  entity: PermissionEntity.asset,
  action: PermissionAction.read,
});

// Acting user's resolved prefs drive the timeframe label ordering.
const prefs = await resolveUserFormatPrefsById(userId, getClientHint(request));

// Parse search params for filters
const url = new URL(request.url);
const timeframePreset =
  (url.searchParams.get("timeframe") as TimeframePreset) || "last_30d";
const customFrom = url.searchParams.get("from");
const customTo = url.searchParams.get("to");

const timeframe = resolveTimeframe(
  timeframePreset,
  customFrom ? new Date(customFrom) : undefined,
  customTo ? new Date(customTo) : undefined,
  prefs
);
```

Add imports:

```ts
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
```

- [ ] **Step 2: CSV export route (`reports.export.$fileName[.csv].tsx`).** Resolve prefs after `requirePermission` (inside the existing `try`) and pass them as the 4th arg to `resolveTimeframe` at `:103`:

```ts
// after requirePermission returns organizationId, before parsing filters:
// Acting user's resolved prefs drive the timeframe label ordering.
const prefs = await resolveUserFormatPrefsById(userId, getClientHint(request));
```

```ts
// before
const timeframe = resolveTimeframe(
  timeframePreset,
  customFrom ? new Date(customFrom) : undefined,
  customTo ? new Date(customTo) : undefined
);

// after
const timeframe = resolveTimeframe(
  timeframePreset,
  customFrom ? new Date(customFrom) : undefined,
  customTo ? new Date(customTo) : undefined,
  prefs
);
```

Add the same two imports (`getClientHint`, `resolveUserFormatPrefsById`).

- [ ] **Step 3: Typecheck.**

```
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. Manual: open a report with a custom timeframe range as a user whose date order is DD_MM_YYYY → the report header label AND the exported CSV filename/label render day-first, matching the client picker footer (Task 6.4).

- [ ] **Step 4: Commit.**

```
git commit -am "feat(reports): timeframe label honors acting user's format prefs

Thread resolveUserFormatPrefsById into the report page loader and CSV export
route, passing the acting user's resolved prefs as the 4th arg to resolveTimeframe
(the PDF site is handled in Task 7.3). Server timeframe labels now match the
client picker's date order instead of the hardcoded en-US default."
```

---

## Phase 8: Shared `<DateTimePicker>` + native-input replacement

This phase builds one shared, prefs-aware `app/components/shared/date-time-picker.tsx`
(Radix Popover + `react-day-picker` `DayPicker` + a `timeFormat`-aware `TimeSelect`),
mirroring the composition of `app/components/reports/timeframe-picker.tsx`, and then
replaces the ~15 native `<input type="datetime-local">` / `type="date"` fields
enumerated in `facts-04` with it — one cluster per task. The picker operates on a
**naive wall-clock `Date`**, renders the trigger label via
`useDateFormatter().formatDate(..., { localeOnly: true })` (no timezone shift),
drives the calendar with `prefs.weekStartsOn`, drives the time control with
`prefs.timeFormat`, and **emits the exact same wire strings the servers already
parse** through a hidden `<input name>` — `YYYY-MM-DD` (date) and
`YYYY-MM-DDTHH:mm` (datetime, = `DATE_TIME_FORMAT`). Because the wire contract is
unchanged, every site's existing server parse is preserved verbatim. This phase
consumes the frozen `useDateFormatter()` hook (Phase 3) and the `ResolvedFormatPrefs`
type (Phase 2) and the `DateTimePickerProps` shape (contract §"Shared picker").

> **Server-parse inconsistency — explicit note (facts-04 §Inferred).** Booking
> (`coerceLocalDate`) and audit (`DateTime.fromFormat({ zone: hints.timeZone })`)
> parse the datetime wire **timezone-aware**; the **reminder** (`z.coerce.date()`)
> and **admin update** (`new Date(str)`) paths parse it **naively** (no tz adjust).
> The picker emits one consistent wire string everywhere. This phase deliberately
> **matches each site's existing server parse per-site** (no server changes) and
> flags unifying the reminder/update parse to be tz-aware as a **follow-up** — see
> the note in Tasks 8.6 and 8.8. Do not change server parse in this phase.

---

### Task 8.1: Add direct `react-day-picker` dependency to the webapp

**Files:** (Modify: `apps/webapp/package.json`)
**Interfaces:** (Consumes: root `package.json:64` pnpm override pinning `react-day-picker@9.14.0`; Produces: a direct `react-day-picker` import path usable by `date-time-picker.tsx`)

`react-day-picker` is currently only a **transitive** dep (via `@tremor/react`,
resolved to `9.14.0` by the root override at `package.json:64`). `timeframe-picker.tsx`
imports it today only because the transitive copy is hoisted; a new first-class
component must not rely on hoisting. Add it as a direct dependency pinned to the same
`9.14.0` the override resolves.

- [ ] **Step 1: Add the dependency line to `apps/webapp/package.json`.** Insert into
      the `dependencies` block, alphabetically near the other `react-*` entries (after
      `"react-day-picker"` does not exist yet; place before `"react-zorm"` at line 128).

```jsonc
    "react-day-picker": "9.14.0",
```

- [ ] **Step 2: Reinstall so the lockfile records the direct dep.** Run from repo root:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` updates the `apps/webapp` importer to list
`react-day-picker@9.14.0` as a direct dep; **no version change** (override already
pins 9.14.0). No other packages change.

- [ ] **Step 3: Confirm resolution.** Run:

```bash
pnpm --filter @shelf/webapp exec node -e "console.log(require('react-day-picker/package.json').version)"
```

Expected output: `9.14.0`.

- [ ] **Step 4: Commit.**

```bash
git add apps/webapp/package.json pnpm-lock.yaml
git commit -m "build(webapp): add direct react-day-picker@9.14.0 dependency

Promote react-day-picker from a transitive (@tremor/react) dep to a direct
webapp dependency so the new shared DateTimePicker can import it without
relying on hoisting. Pinned to 9.14.0 to match the root pnpm override."
```

---

### Task 8.2: Extend `TimeSelect` with a `timeFormat` display param

**Files:** (Modify: `apps/webapp/app/components/forms/time-select.tsx:48-131`, `:173-256`; Test: `apps/webapp/app/components/forms/time-select.test.ts`)
**Interfaces:** (Consumes: `TimeFormatPreference` from `@prisma/client`; Produces: `TimeSelectProps.timeFormat?: TimeFormatPreference`, exported `getDisplayLabel(value24, timeFormat?)`)

`TimeSelect` stores 24h `HH:mm` values but its display labels are hardwired to 12h
AM/PM (`getDisplayLabel` at `:120-131`). The datetime picker must honour the user's
`prefs.timeFormat` (H12|H24). Add a `timeFormat` prop (default `"H12"` — preserves
every current call site) that switches label rendering, and export `getDisplayLabel`
so it is unit-testable.

- [ ] **Step 1: Write the failing test.** Create
      `apps/webapp/app/components/forms/time-select.test.ts`:

```ts
/**
 * TimeSelect display-label formatting — unit tests
 *
 * Verifies `getDisplayLabel` renders a stored 24h value in the caller's
 * chosen time format: 12h AM/PM (default) or raw 24h HH:mm.
 *
 * @see {@link file://./time-select.tsx}
 */
import { describe, it, expect } from "vitest";
import { getDisplayLabel } from "./time-select";

describe("getDisplayLabel", () => {
  it("renders 12-hour AM/PM by default", () => {
    expect(getDisplayLabel("09:00")).toBe("9:00 AM");
    expect(getDisplayLabel("13:15")).toBe("1:15 PM");
    expect(getDisplayLabel("00:00")).toBe("12:00 AM");
  });

  it("renders the 23:59 end-of-day sentinel", () => {
    expect(getDisplayLabel("23:59", "H12")).toBe("11:59 PM");
    expect(getDisplayLabel("23:59", "H24")).toBe("23:59");
  });

  it("renders raw 24-hour HH:mm when timeFormat is H24", () => {
    expect(getDisplayLabel("09:00", "H24")).toBe("09:00");
    expect(getDisplayLabel("13:15", "H24")).toBe("13:15");
    expect(getDisplayLabel("00:00", "H24")).toBe("00:00");
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`getDisplayLabel` is not exported yet
      and takes no `timeFormat`).

```bash
pnpm webapp:test -- --run app/components/forms/time-select.test.ts
```

Expected: fails (import/undefined or signature mismatch).

- [ ] **Step 3: Add the `TimeFormatPreference` import** at the top of
      `time-select.tsx` (after the existing `date-fns` import at `:3`):

```ts
import type { TimeFormatPreference } from "@prisma/client";
```

- [ ] **Step 4: Rewrite `getDisplayLabel` (`:115-131`) to accept `timeFormat`:**

```ts
/**
 * Finds the display label for a given 24-hour time value.
 *
 * @param value24 - Time in 24-hour format (HH:mm)
 * @param timeFormat - "H12" (default) → "9:00 AM"; "H24" → "09:00"
 * @returns Display label, or empty string if the value is unparseable
 */
function getDisplayLabel(
  value24: string,
  timeFormat: TimeFormatPreference = "H12"
): string {
  // 24h display: the stored value already IS the display string.
  if (timeFormat === "H24") {
    return value24;
  }

  // First check if it's the special 23:59 end-of-day case
  if (value24 === "23:59") {
    return "11:59 PM";
  }

  try {
    return convert24To12Hour(value24);
  } catch {
    return "";
  }
}
```

- [ ] **Step 5: Add `timeFormat` to `TimeSelectProps`** (`:25-46`, after the
      `"aria-label"?` prop):

```ts
  /** Aria label for accessibility */
  "aria-label"?: string;
  /** Display format for the time labels: "H12" (default) or "H24" */
  timeFormat?: TimeFormatPreference;
```

- [ ] **Step 6: Thread `timeFormat` through the component** (`:173-203`). Add it to
      the destructured props (default `"H12"`) and use it for the trigger's display value:

```tsx
export const TimeSelect: FC<TimeSelectProps> = ({
  name,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  placeholder = "Select time",
  required = false,
  className,
  error,
  "aria-label": ariaLabel,
  timeFormat = "H12",
}) => {
```

And update the `displayValue` line (`:203`):

```tsx
const displayValue = currentValue
  ? getDisplayLabel(currentValue, timeFormat)
  : undefined;
```

- [ ] **Step 7: Use `timeFormat` for the dropdown item labels** (`:239-248`). Replace
      `option.label` with a `timeFormat`-aware call so H24 items render as `HH:mm`:

```tsx
{
  TIME_OPTIONS.map((option) => (
    <SelectItem
      key={option.value}
      value={option.value}
      className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
    >
      <span className="mr-4 block text-[14px] text-gray-700">
        {getDisplayLabel(option.value, timeFormat)}
      </span>
    </SelectItem>
  ));
}
```

- [ ] **Step 8: Export `getDisplayLabel`** — extend the utility export line at `:259`:

```ts
export {
  convert24To12Hour,
  convert12To24Hour,
  generateTimeOptions,
  getDisplayLabel,
};
```

- [ ] **Step 9: Run the test — expect PASS.**

```bash
pnpm webapp:test -- --run app/components/forms/time-select.test.ts
```

Expected: all 3 `describe` cases pass.

- [ ] **Step 10: Typecheck** (default `timeFormat="H12"` keeps all existing call sites
      in `working-hours/overrides/override-dialog.tsx` + weekly-schedule valid).

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no new errors.

- [ ] **Step 11: Commit.**

```bash
git add apps/webapp/app/components/forms/time-select.tsx apps/webapp/app/components/forms/time-select.test.ts
git commit -m "feat(webapp): make TimeSelect honour a timeFormat display param

Add an optional timeFormat (H12 default | H24) prop to TimeSelect so the
shared DateTimePicker can render times in the user's preferred format.
Export getDisplayLabel and cover it with unit tests. Existing call sites
keep the 12-hour default unchanged."
```

---

### Task 8.3: Build the shared `<DateTimePicker>` component

**Files:** (Create: `apps/webapp/app/components/shared/date-time-picker.tsx`, `apps/webapp/app/components/shared/date-time-picker.test.tsx`)
**Interfaces:** (Consumes: `useDateFormatter()` → `{ prefs: ResolvedFormatPrefs; formatDate }` (Phase 3 contract), `TimeSelect` w/ `timeFormat` (Task 8.2), `DateTimePickerProps` (contract §"Shared picker"); Produces: `DateTimePicker`, `parseWireToParts`, `partsToWire` for all replacement tasks)

Build the component per the frozen `DateTimePickerProps`. It emits `YYYY-MM-DD` (date
mode) or `YYYY-MM-DDTHH:mm` (datetime mode, = `DATE_TIME_FORMAT`). Two pure helpers
(`parseWireToParts`, `partsToWire`) do the wire↔parts conversion using **local
wall-clock** construction (no `Date.parse`/ISO, which would tz-shift a bare date) —
these are the round-trip contract and are unit-tested first.

- [ ] **Step 1: Write the failing test** — pure round-trip + a render/interaction
      check. Create `apps/webapp/app/components/shared/date-time-picker.test.tsx`:

```tsx
/**
 * DateTimePicker — unit + interaction tests
 *
 * Verifies:
 *  - parseWireToParts / partsToWire round-trip losslessly for both modes and
 *    never tz-shift a bare date (local wall-clock construction).
 *  - The hidden <input name> mirrors the emitted wire string so form
 *    submission carries the exact string the servers parse.
 *  - The calendar renders with the user's weekStartsOn (Monday header first).
 *
 * @see {@link file://./date-time-picker.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  DateTimePicker,
  parseWireToParts,
  partsToWire,
} from "./date-time-picker";

// why: useDateFormatter reads useRequestInfo(), which needs the root loader's
// RequestInfo context (unavailable in a unit test). We stub the hook with a
// fixed Monday-start / H24 prefs object to exercise the picker deterministically.
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    prefs: {
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStartsOn: 1,
      timeZone: "Europe/London",
    },
    formatDate: (value: string | Date) =>
      value instanceof Date ? value.toDateString() : value,
    formatTime: (v: string | Date) => String(v),
    formatDateTime: (v: string | Date) => String(v),
  }),
}));

describe("wire helpers", () => {
  it("round-trips a date-only wire without tz shift", () => {
    const { date, time } = parseWireToParts("2026-06-22");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(5); // June (0-indexed)
    expect(date?.getDate()).toBe(22);
    expect(time).toBe("");
    expect(partsToWire(date, "", "date")).toBe("2026-06-22");
  });

  it("round-trips a datetime wire", () => {
    const { date, time } = parseWireToParts("2026-06-22T18:30");
    expect(time).toBe("18:30");
    expect(partsToWire(date, time, "datetime")).toBe("2026-06-22T18:30");
  });

  it("returns empty parts for an empty/invalid wire", () => {
    expect(parseWireToParts("").date).toBeUndefined();
    expect(parseWireToParts(undefined).date).toBeUndefined();
    expect(partsToWire(undefined, "", "date")).toBe("");
  });

  it("defaults datetime time to 00:00 when none provided", () => {
    const { date } = parseWireToParts("2026-06-22");
    expect(partsToWire(date, "", "datetime")).toBe("2026-06-22T00:00");
  });
});

describe("DateTimePicker", () => {
  it("mirrors the controlled value into the hidden input", () => {
    render(
      <DateTimePicker
        name="dueDate"
        mode="datetime"
        value="2026-06-22T18:30"
        label="Due date"
      />
    );
    const hidden = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="dueDate"]'
    );
    expect(hidden?.value).toBe("2026-06-22T18:30");
  });

  it("renders the trigger label and the field label", () => {
    render(
      <DateTimePicker name="date" value="2026-06-22" label="Override Date" />
    );
    expect(screen.getByText("Override Date")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (module does not exist yet).

```bash
pnpm webapp:test -- --run app/components/shared/date-time-picker.test.tsx
```

Expected: fails to resolve `./date-time-picker`.

- [ ] **Step 3: Create the component file** `apps/webapp/app/components/shared/date-time-picker.tsx`:

```tsx
/**
 * DateTimePicker — shared, prefs-aware date & datetime input
 *
 * A shadcn-style picker (Radix Popover + react-day-picker DayPicker +
 * TimeSelect) that replaces the native `<input type="date">` /
 * `type="datetime-local"` fields across the app. It renders and reads dates in
 * the user's `dateFormat` / `weekStart` / `timeFormat` (via `useDateFormatter`)
 * but **emits the exact wire strings the existing servers already parse** —
 * `YYYY-MM-DD` (date) or `YYYY-MM-DDTHH:mm` (datetime, = DATE_TIME_FORMAT) —
 * through a hidden `<input name>`, so it drops into both zorm forms
 * (`zo.fields.x()`) and plain `<Form>`s without any server-side change.
 *
 * The picker operates on a NAIVE wall-clock Date: the trigger label is rendered
 * with `formatDate(..., { localeOnly: true })` (no timezone conversion), and the
 * emitted wire is the wall-clock string. Each call site's server keeps its own
 * timezone handling (booking `coerceLocalDate`, audit `DateTime.fromFormat`,
 * filters `adjustDateToUTC`, reminder/update naive parse).
 *
 * @see {@link file://../reports/timeframe-picker.tsx} composition reference
 * @see {@link file://../forms/time-select.tsx} time control
 * @see {@link file://../../hooks/use-date-formatter.ts} prefs source
 */

import type React from "react";
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarIcon, X } from "lucide-react";
import type { Matcher } from "react-day-picker";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { InnerLabel } from "~/components/forms/inner-label";
import { TimeSelect } from "~/components/forms/time-select";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import { tw } from "~/utils/tw";

/** CSS custom properties theming react-day-picker (mirrors timeframe-picker). */
const dayPickerStyles = {
  "--rdp-accent-color": "#F97316",
  "--rdp-accent-background-color": "#FFF7ED",
  "--rdp-day-width": "32px",
  "--rdp-day-height": "32px",
  "--rdp-day_button-width": "32px",
  "--rdp-day_button-height": "32px",
  "--rdp-months-gap": "16px",
  "--rdp-selected-font-weight": "400",
  "--rdp-range_middle-font-weight": "400",
  fontSize: "13px",
  fontWeight: 400,
} as React.CSSProperties;

/** Props for {@link DateTimePicker}. Frozen by the interfaces contract. */
export type DateTimePickerProps = {
  /** Form field name — carried by the hidden input the server reads. */
  name: string;
  /** "date" → YYYY-MM-DD; "datetime" → YYYY-MM-DDTHH:mm. Default "date". */
  mode?: "date" | "datetime";
  /** Controlled wire string. */
  value?: string;
  /** Uncontrolled initial wire string. */
  defaultValue?: string;
  /** Called with the new wire string on every change. */
  onChange?: (wire: string) => void;
  /** Earliest selectable date (inclusive). */
  min?: Date;
  /** Latest selectable date (inclusive). */
  max?: Date;
  /** Field label. */
  label?: string;
  /** Visually hide the label on large screens. */
  hideLabel?: boolean;
  /** Server/validation error to display below the field. */
  error?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Trigger placeholder when no value is selected. */
  placeholder?: string;
  /** Show a Clear affordance that empties the field. */
  clearable?: boolean;
};

/**
 * Parse a wire string into a NAIVE local Date + a 24h `HH:mm` time string.
 * Uses component-wise construction (never `Date.parse`) so a bare `YYYY-MM-DD`
 * is not interpreted as UTC midnight and shifted across the date line.
 *
 * @param wire - `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (or undefined/empty)
 * @returns `{ date, time }` — `date` undefined for empty/invalid input
 */
export function parseWireToParts(wire: string | undefined): {
  date: Date | undefined;
  time: string;
} {
  if (!wire) return { date: undefined, time: "" };
  const [datePart, timePart] = wire.split("T");
  const [y, m, d] = datePart.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return { date: undefined, time: "" };
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return { date: undefined, time: "" };
  return { date, time: timePart ? timePart.slice(0, 5) : "" };
}

/**
 * Build the wire string from a selected Date + 24h time for the given mode.
 *
 * @param date - selected day (naive wall-clock) or undefined
 * @param time - 24h `HH:mm` (datetime mode); ignored for date mode
 * @param mode - "date" | "datetime"
 * @returns wire string, or "" when no date is selected
 */
export function partsToWire(
  date: Date | undefined,
  time: string,
  mode: "date" | "datetime"
): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const datePart = `${y}-${m}-${d}`;
  if (mode === "date") return datePart;
  return `${datePart}T${time || "00:00"}`;
}

/**
 * Shared date / datetime picker. See file header for the wire contract.
 *
 * @param props - {@link DateTimePickerProps}
 */
export function DateTimePicker({
  name,
  mode = "date",
  value,
  defaultValue,
  onChange,
  min,
  max,
  label,
  hideLabel,
  error,
  disabled = false,
  required = false,
  className,
  placeholder = "Select date",
  clearable = false,
}: DateTimePickerProps) {
  const { prefs, formatDate } = useDateFormatter();
  const isControlled = value !== undefined;

  const [open, setOpen] = useState(false);
  const [internalWire, setInternalWire] = useState<string>(
    () => value ?? defaultValue ?? ""
  );

  // In controlled mode, reflect the external value into internal state.
  useEffect(() => {
    if (isControlled) setInternalWire(value ?? "");
  }, [isControlled, value]);

  const wire = internalWire;
  const { date: selectedDate, time } = parseWireToParts(wire);

  /** Commit a new wire string: update internal state + notify parent. */
  const commit = (nextWire: string) => {
    setInternalWire(nextWire);
    onChange?.(nextWire);
  };

  const handleDaySelect = (day: Date | undefined) => {
    // Datetime keeps the current time, or defaults to 09:00 for a fresh pick.
    const nextTime = mode === "datetime" ? time || "09:00" : "";
    commit(partsToWire(day, nextTime, mode));
    if (mode === "date") setOpen(false);
  };

  const handleTimeChange = (nextTime: string) => {
    commit(partsToWire(selectedDate ?? new Date(), nextTime, mode));
  };

  const handleClear = () => {
    commit("");
    setOpen(false);
  };

  // Trigger label uses localeOnly so the wall-clock value is shown verbatim
  // (no timezone conversion of the picker's naive Date).
  const displayLabel = selectedDate
    ? formatDate(selectedDate, {
        localeOnly: true,
        includeTime: mode === "datetime",
      })
    : placeholder;

  // Build react-day-picker disabled matchers from min/max bounds.
  const disabledMatchers: Matcher[] = [];
  if (min) disabledMatchers.push({ before: min });
  if (max) disabledMatchers.push({ after: max });

  return (
    <div className={tw("w-full", className)}>
      {label ? (
        <InnerLabel hideLg={hideLabel} required={required}>
          {label}
        </InnerLabel>
      ) : null}

      {/* Hidden field carries the wire string to the server — works for both
          zorm (zo.fields.x()) and plain-name forms. */}
      <input type="hidden" name={name} value={wire} />

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={label ?? "Select date"}
            className={tw(
              "flex w-full items-center gap-2 rounded border px-3.5 py-2 text-left text-sm transition-colors",
              "focus:outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-100",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error
                ? "border-error-500"
                : "border-gray-300 hover:border-gray-400",
              !selectedDate && "text-gray-500"
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-gray-500" />
            <span className="truncate">{displayLabel}</span>
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className={tw(
              "z-50 rounded border border-gray-200 bg-white p-4 shadow-lg",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
            )}
            sideOffset={8}
            align="start"
          >
            {/* react-doctor-safe static <style> forcing non-bold day buttons */}
            <style>{`
              .rdp-day button,
              .rdp-day_button,
              .rdp-selected .rdp-day_button {
                font-weight: 400 !important;
              }
            `}</style>
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={handleDaySelect}
              showOutsideDays
              weekStartsOn={prefs.weekStartsOn}
              disabled={
                disabledMatchers.length > 0 ? disabledMatchers : undefined
              }
              style={dayPickerStyles}
            />

            {mode === "datetime" ? (
              <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                <span className="text-xs font-medium text-gray-600">Time</span>
                <TimeSelect
                  // Namespaced, display-only helper field: the datetime wire is
                  // already carried by the hidden input above; this name is not
                  // read by any server action.
                  name={`${name}__time`}
                  value={time || "09:00"}
                  onValueChange={handleTimeChange}
                  timeFormat={prefs.timeFormat}
                  aria-label="Select time"
                />
              </div>
            ) : null}

            {clearable && selectedDate ? (
              <div className="mt-3 flex justify-end border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  <X className="size-3" />
                  Clear
                </button>
              </div>
            ) : null}

            <Popover.Arrow className="fill-white" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {error ? (
        <div className="mt-1 text-sm text-error-500">{error}</div>
      ) : null}
    </div>
  );
}

export default DateTimePicker;
```

- [ ] **Step 4: Run the test — expect PASS.**

```bash
pnpm webapp:test -- --run app/components/shared/date-time-picker.test.tsx
```

Expected: all `wire helpers` and `DateTimePicker` cases pass.

- [ ] **Step 5: Typecheck.**

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors (confirms the `Matcher` import, `weekStartsOn: 0 | 1 | 6`
assignment to DayPicker, and the `DateTimePickerProps` shape match the contract).

- [ ] **Step 6: Commit.**

```bash
git add apps/webapp/app/components/shared/date-time-picker.tsx apps/webapp/app/components/shared/date-time-picker.test.tsx
git commit -m "feat(webapp): add shared prefs-aware DateTimePicker component

New app/components/shared/date-time-picker.tsx composes Radix Popover +
react-day-picker + TimeSelect. Renders in the user's dateFormat/weekStart/
timeFormat via useDateFormatter, but emits the same YYYY-MM-DD / YYYY-MM-DDTHH:mm
wire strings the existing servers parse through a hidden input. Pure
parseWireToParts/partsToWire helpers are unit-tested for lossless round-trips."
```

---

### Task 8.4: Replace booking Start/End native inputs (`dates.tsx`)

**Files:** (Modify: `apps/webapp/app/components/booking/forms/fields/dates.tsx:53-131`)
**Interfaces:** (Consumes: `DateTimePicker` (Task 8.3); Produces: booking date fields emitting `YYYY-MM-DDTHH:mm` — unchanged server parse via `coerceLocalDate(hints.timeZone)` in `forms-schema.ts`)

Both fields are **controlled** (`value`/`onChange` string state owned by the parent).
The auto-bump-end-to-18:00 logic stays in the parent's `onChange`; only the input
element changes. `DateTimePicker` `onChange` gives the same wire string the native
input's `event.target.value` produced, so the existing handler body is preserved
verbatim (adapt the signature from `event` to `next`).

- [ ] **Step 1: Swap the `Input` import for `DateTimePicker`.** In `dates.tsx`, replace
      the import at `:3`:

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

(Remove the now-unused `import Input from "~/components/forms/input";` **only if**
no other `Input` usage remains in the file — it does not; `Input` at `:3` is the
sole usage.)

- [ ] **Step 2: Replace the Start Date `Input` (`:53-109`)** with `DateTimePicker`,
      moving the auto-bump logic into the `onChange(next)` callback:

```tsx
<DateTimePicker
  mode="datetime"
  label="Start Date"
  hideLabel
  name={startDateName}
  disabled={workingHoursDisabled}
  error={startDateError}
  className="w-full"
  value={startDate}
  placeholder="Booking"
  required
  onChange={(next) => {
    // Update start date state to persist user's selection
    setStartDate(next);

    /**
     * When user changes the startDate and the new startDate is greater
     * than the endDate, bump endDate to 6 PM on the start day.
     */
    if (isNewBooking && endDate && next) {
      try {
        // datetime wire format is YYYY-MM-DDTHH:mm
        const newStartDate = new Date(next);
        const currentEndDate = new Date(endDate);

        if (
          !isNaN(newStartDate.getTime()) &&
          !isNaN(currentEndDate.getTime()) &&
          newStartDate > currentEndDate
        ) {
          const endDateTime = new Date(newStartDate);
          endDateTime.setHours(18, 0, 0, 0);

          const newEndDate = dateForDateTimeInputValue(endDateTime);
          setEndDate(newEndDate.substring(0, newEndDate.length - 3));
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("Date parsing failed in start date onChange:", error);
      }
    }
  }}
/>
```

- [ ] **Step 3: Replace the End Date `Input` (`:116-131`)**:

```tsx
<DateTimePicker
  mode="datetime"
  label="End Date"
  hideLabel
  name={endDateName}
  disabled={workingHoursDisabled}
  error={endDateError}
  className="w-full"
  placeholder="Booking"
  required
  value={endDate}
  onChange={(next) => {
    setEndDate(next);
  }}
/>
```

- [ ] **Step 4: Typecheck.**

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors (`dateForDateTimeInputValue` import at `:14` still used).

- [ ] **Step 5: Manual verification.** `pnpm webapp:dev`, then:

  1. New booking form → open Start Date picker → confirm calendar week starts on the
     user's `weekStart`, the time control renders in the user's `timeFormat`.
  2. Pick a start date/time **after** the current end → confirm End Date auto-bumps to
     18:00 on the start day.
  3. Submit → confirm the booking saves with the intended start/end (server
     `coerceLocalDate` parse unchanged).

- [ ] **Step 6: Commit.**

```bash
git add apps/webapp/app/components/booking/forms/fields/dates.tsx
git commit -m "feat(webapp): use DateTimePicker for booking start/end dates

Replace the native datetime-local inputs with the shared prefs-aware
DateTimePicker. Controlled value/onChange and the auto-bump-end-to-6PM
logic stay in the parent; the emitted YYYY-MM-DDTHH:mm wire is unchanged
so coerceLocalDate server parsing is preserved."
```

---

### Task 8.5: Replace extend-booking end date input (`extend-booking-dialog.tsx`)

**Files:** (Modify: `apps/webapp/app/components/booking/extend-booking-dialog.tsx:115-129`)
**Interfaces:** (Consumes: `DateTimePicker`; Produces: uncontrolled zorm-managed `endDate` field, wire `YYYY-MM-DDTHH:mm` — unchanged `ExtendBookingSchema` parse)

Uncontrolled: `defaultValue={currentEndDate}`, field name from `zo.fields.endDate()`.
The hidden input carries the wire to zorm exactly as the native input did.

- [ ] **Step 1: Add the import** near the top of `extend-booking-dialog.tsx` (beside
      the existing `Input` import):

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 2: Replace the `Input` (`:115-129`)**:

```tsx
<DateTimePicker
  key={currentEndDate}
  mode="datetime"
  defaultValue={currentEndDate}
  label="End Date"
  hideLabel
  name={zo.fields.endDate()}
  disabled={disabled || workingHoursDisabled}
  error={validationErrors?.endDate?.message || zo.errors.endDate()?.message}
  className="mb-4 w-full"
  placeholder="Booking"
/>
```

- [ ] **Step 3: Typecheck.**

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. (Leave the `Input` import if still used elsewhere in the file;
remove it only if this was its sole usage.)

- [ ] **Step 4: Manual verification.** Dev server → open a booking → "Extend booking"
      dialog → confirm the picker defaults to the current end date, renders in the user's
      prefs, and submitting a future date extends the booking (server `ExtendBookingSchema`
      unchanged); a past date still shows the server validation error.

- [ ] **Step 5: Commit.**

```bash
git add apps/webapp/app/components/booking/extend-booking-dialog.tsx
git commit -m "feat(webapp): use DateTimePicker for extend-booking end date

Swap the native datetime-local input for the shared picker (uncontrolled,
zorm field name). Wire string and ExtendBookingSchema parsing unchanged."
```

---

### Task 8.6: Replace asset-reminder alert date input (`set-or-edit-reminder-dialog.tsx`)

**Files:** (Modify: `apps/webapp/app/components/asset-reminder/set-or-edit-reminder-dialog.tsx:160-180`)
**Interfaces:** (Consumes: `DateTimePicker`; Produces: uncontrolled zorm `alertDateTime` field, wire `YYYY-MM-DDTHH:mm`)

> **Server-parse note (flag, no change this phase).** `setReminderSchema` parses
> `alertDateTime` with `z.coerce.date()` — a **naive** parse with **no timezone
> adjustment**, unlike booking/audit. The picker emits the same wire string the native
> input produced, so behaviour is byte-for-byte unchanged. **Follow-up (out of scope):**
> unify this with the tz-aware audit parse (`DateTime.fromFormat({ zone })`) so the
> reminder fires at the user's local wall-clock time regardless of server tz. Do **not**
> change the schema here.

- [ ] **Step 1: Add the import** near the top of the dialog file (beside `Input`):

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 2: Replace the `Input` (`:161-180`)**. The `defaultValue` uses
      `dateForDateTimeInputValue(...)` which already yields a `YYYY-MM-DDTHH:mm:ss` string;
      slice to 16 chars so it matches the datetime wire the picker parses:

```tsx
<DateTimePicker
  mode="datetime"
  defaultValue={
    reminder?.alertDateTime
      ? dateForDateTimeInputValue(new Date(reminder.alertDateTime)).substring(
          0,
          16
        )
      : undefined
  }
  name={zo.fields.alertDateTime()}
  error={
    validationErrors?.alertDateTime?.message ||
    zo.errors.alertDateTime()?.message
  }
  label="Reminder Date"
  disabled={disabled}
  required
  className="mb-2"
/>
```

- [ ] **Step 3: Typecheck.**

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors (`dateForDateTimeInputValue` import already present).

- [ ] **Step 4: Manual verification.** Dev server → asset → set a reminder → confirm
      the picker prefills an existing reminder's datetime, a **past** date still triggers
      the `.min(new Date(), "...future")` server error, and a future save persists the
      same instant as before this change.

- [ ] **Step 5: Commit.**

```bash
git add apps/webapp/app/components/asset-reminder/set-or-edit-reminder-dialog.tsx
git commit -m "feat(webapp): use DateTimePicker for asset-reminder alert date

Replace the native datetime-local input with the shared picker (uncontrolled
zorm field). Wire string and setReminderSchema z.coerce.date() parse unchanged.
Note: reminder parse remains tz-naive; unifying with the tz-aware audit parse
is a documented follow-up, not part of this change."
```

---

### Task 8.7: Replace the three audit due-date inputs (edit / start / from-context)

**Files:** (Modify: `apps/webapp/app/components/audit/edit-audit-dialog.tsx:143-150`, `apps/webapp/app/components/audit/start-audit-dialog-content.tsx:158-165`, `apps/webapp/app/components/audit/start-audit-from-context-dialog.tsx:238-245`)
**Interfaces:** (Consumes: `DateTimePicker`; Produces: audit `dueDate` fields emitting `YYYY-MM-DDTHH:mm` = `DATE_TIME_FORMAT` — unchanged tz-aware server parse in `api+/audits.start.ts`)

All three feed the **timezone-aware** server parse
(`DateTime.fromFormat(dueDateString, DATE_TIME_FORMAT, { zone: hints.timeZone })`), so
the wire must remain exactly `YYYY-MM-DDTHH:mm`. The picker emits precisely that.

- [ ] **Step 1: edit-audit-dialog — add import** (beside `Input`):

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 2: edit-audit-dialog — replace the `Input` (`:143-150`).** `defaultDueDate`
      (`:72-75`) is already `.substring(0, 16)` → matches the datetime wire:

```tsx
<DateTimePicker
  mode="datetime"
  name={dueDateField}
  label="Due date"
  defaultValue={defaultDueDate}
  error={dueDateError}
/>
```

- [ ] **Step 3: start-audit-dialog-content — add import** (beside `Input`):

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 4: start-audit-dialog-content — replace the `Input` (`:158-165`)** (no
      default value; uncontrolled):

```tsx
<DateTimePicker
  mode="datetime"
  name={dueDateField}
  label="Due date"
  error={dueDateError}
  disabled={formDisabled}
  className="mt-4"
/>
```

- [ ] **Step 5: start-audit-from-context-dialog — add import** (beside `Input`):

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 6: start-audit-from-context-dialog — replace the `Input` (`:238-245`)**:

```tsx
<DateTimePicker
  mode="datetime"
  name={zo.fields.dueDate()}
  label="Due date"
  error={zo.errors.dueDate()?.message}
  disabled={isSubmitting}
  className="mt-4"
/>
```

- [ ] **Step 7: Typecheck.**

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. (Remove each file's now-unused `Input` import only if it was the
sole usage in that file.)

- [ ] **Step 8: Manual verification.** Dev server:

  1. Edit an existing audit → confirm the picker prefills the audit's due date.
  2. Start a new audit (both the dialog-content and the from-context entry points) →
     pick a due date/time → submit → confirm the audit's `dueDate` matches the picked
     wall-clock time under the user's timezone (server `DateTime.fromFormat({ zone })`
     path unchanged).

- [ ] **Step 9: Commit.**

```bash
git add apps/webapp/app/components/audit/edit-audit-dialog.tsx apps/webapp/app/components/audit/start-audit-dialog-content.tsx apps/webapp/app/components/audit/start-audit-from-context-dialog.tsx
git commit -m "feat(webapp): use DateTimePicker for audit due-date inputs

Replace the three native datetime-local inputs (edit/start/from-context) with
the shared picker. Emits DATE_TIME_FORMAT wire so the tz-aware DateTime.fromFormat
parse in api+/audits.start.ts is preserved."
```

---

### Task 8.8: Replace admin update publish-date input (`update-form.tsx`)

**Files:** (Modify: `apps/webapp/app/components/update/update-form.tsx:97-103`)
**Interfaces:** (Consumes: `DateTimePicker`; Produces: plain-name `publishDate` field, wire `YYYY-MM-DDTHH:mm`)

> **Server-parse note (flag, no change this phase).** `updates.new.tsx:57` and
> `updates.$updateId.edit.tsx:76` parse `publishDate` with
> `z.string().transform((str) => new Date(str))` — a **naive** `new Date(str)` with **no
> timezone adjustment** (same class as the reminder in Task 8.6). The picker emits the
> same wire the native input produced → unchanged behaviour. **Follow-up (out of scope):**
> optionally make this tz-aware. Do **not** change the parse here.

This is a plain `<Form>` field (no zorm). The hidden input's `name="publishDate"`
carries the value identically.

- [ ] **Step 1: Add the import** (beside `Input`):

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 2: Replace the `Input` (`:97-103`).** Keep the surrounding `<label>` block;
      the picker keeps its own label off (the visible label is the sibling `<label>` at
      `:91-96`) — pass no `label` so no duplicate renders:

```tsx
<DateTimePicker
  mode="datetime"
  name="publishDate"
  defaultValue={defaultPublishDate}
  required
/>
```

- [ ] **Step 3: Typecheck.**

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors.

- [ ] **Step 4: Manual verification.** Dev server (admin) → Updates → new/edit an update
      → confirm the publish-date picker prefills, renders in prefs, and saving persists the
      same instant as before (`new Date(str)` parse unchanged).

- [ ] **Step 5: Commit.**

```bash
git add apps/webapp/app/components/update/update-form.tsx
git commit -m "feat(webapp): use DateTimePicker for admin update publish date

Replace the native datetime-local input with the shared picker (plain
name=publishDate). Wire string and the naive new Date(str) parse in the
update routes are unchanged; tz-aware parse is a documented follow-up."
```

---

### Task 8.9: Replace custom-field DATE inputs (create/edit form + asset-overview inline)

**Files:** (Modify: `apps/webapp/app/components/assets/custom-fields-inputs.tsx:90-128`, `apps/webapp/app/routes/_layout+/assets.$assetId.overview.tsx:1454-1464`)
**Interfaces:** (Consumes: `DateTimePicker`; Produces: date-only fields `cf-<id>` (controlled, clearable) and `fieldValue` (uncontrolled), wire `YYYY-MM-DD`)

Two surfaces render the same custom-field DATE. The create/edit form is **controlled**
(`dateObj` state, `YYYY-MM-DD`) with a separate clear button — fold the clear into the
picker's `clearable` prop. The overview inline edit is **uncontrolled** (`defaultValue`,
plain `name="fieldValue"`).

- [ ] **Step 1: custom-fields-inputs — add the import** (beside `Input`):

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 2: custom-fields-inputs — replace the DATE block (`:90-128`)** with a
      single clearable `DateTimePicker`. The controlled `value` is the `YYYY-MM-DD` string
      derived from `dateObj`; `onChange(next)` reuses the existing invalid→now guard, and
      an empty wire clears the entry:

```tsx
    DATE: (field) => (
      <div className="flex w-full items-end">
        <DateTimePicker
          className="w-full"
          label={field.name}
          hideLabel
          name={`cf-${field.id}`}
          value={dateObj[field.id]?.toISOString().split("T")[0] || ""}
          clearable
          onChange={(next) => {
            if (!next) {
              // Clear affordance emits an empty wire.
              setDateObj({ ...dateObj, [field.id]: null });
              return;
            }

            let selectedDate = new Date(next);

            /**
             * Guard against an unparseable value so we never store an invalid
             * Date (mirrors the previous native-input behaviour).
             */
            if (isNaN(selectedDate.valueOf())) {
              selectedDate = new Date();
            }

            setDateObj({ ...dateObj, [field.id]: selectedDate });
          }}
          error={getFieldError(field.id)}
          disabled={disabled}
        />
      </div>
    ),
```

(This removes the standalone clear `Button` at `:117-127` — its behaviour now lives in
the picker's `clearable`. Verify no other reference to that button remains.)

- [ ] **Step 3: assets.$assetId.overview — add the import** near the other component
      imports in `assets.$assetId.overview.tsx`:

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 4: assets.$assetId.overview — replace the inline DATE `Input` (`:1455-1464`)**:

```tsx
                            case CustomFieldType.DATE:
                              return (
                                <DateTimePicker
                                  label={def.name}
                                  hideLabel
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full"
                                />
                              );
```

- [ ] **Step 5: Typecheck.**

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. (If `Input`/`Button` become unused in `custom-fields-inputs.tsx`,
remove those imports; `Button` is likely still used by other field types — keep if so.)

- [ ] **Step 6: Manual verification.** Dev server:

  1. Asset create/edit form with a DATE custom field → pick a date (calendar honours
     `weekStart`), confirm the value submits as `YYYY-MM-DD`; click Clear → confirm the
     value empties.
  2. Asset overview → inline-edit a DATE custom field → confirm it prefills `rawValue`
     and saves as `YYYY-MM-DD`.

- [ ] **Step 7: Commit.**

```bash
git add apps/webapp/app/components/assets/custom-fields-inputs.tsx "apps/webapp/app/routes/_layout+/assets.\$assetId.overview.tsx"
git commit -m "feat(webapp): use DateTimePicker for custom-field DATE inputs

Replace the native date inputs on the custom-field create/edit form (controlled,
now using the picker's clearable affordance) and the asset-overview inline edit
(uncontrolled). Both keep emitting the YYYY-MM-DD wire."
```

---

### Task 8.10: Replace working-hours override date input (`override-dialog.tsx`)

**Files:** (Modify: `apps/webapp/app/components/working-hours/overrides/override-dialog.tsx:144-154`)
**Interfaces:** (Consumes: `DateTimePicker`; Produces: uncontrolled zorm `date` field with `min` bound, wire `YYYY-MM-DD`; the paired `TimeSelect`s at `:167-177` are unchanged)

Uncontrolled zorm field with a `min={todayAbsolute}` constraint and paired open/close
`TimeSelect`s below (which already use Task 8.2's default `timeFormat="H12"` — left as
is; a separate follow-up could pass `prefs.timeFormat`). The picker's `min` prop maps
`todayAbsolute` (a `Date`) into a react-day-picker `{ before }` matcher.

- [ ] **Step 1: Add the import** (beside `Input`):

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 2: Replace the `Input` (`:144-154`)**. `min` was a string on the native
      input; `DateTimePicker.min` takes a `Date` — `todayAbsolute` is already a `Date` in
      this file, so pass it directly (confirm its type at the declaration; if it is a string
      wrap with `new Date(todayAbsolute)`):

```tsx
<DateTimePicker
  label="Override Date"
  hideLabel
  name={zo.fields.date()}
  disabled={disabled}
  required
  min={todayAbsolute}
  error={zo.errors.date()?.message}
  className="w-full"
/>
```

- [ ] **Step 3: Typecheck.**

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors. If typecheck reports `todayAbsolute` is a `string`, change the
prop to `min={new Date(todayAbsolute)}` and re-run.

- [ ] **Step 4: Manual verification.** Dev server → Settings → Working hours → add an
      override → confirm the calendar disables days before today (`min`), a date submits as
      `YYYY-MM-DD`, and the paired open/close `TimeSelect`s still work.

- [ ] **Step 5: Commit.**

```bash
git add apps/webapp/app/components/working-hours/overrides/override-dialog.tsx
git commit -m "feat(webapp): use DateTimePicker for working-hours override date

Replace the native date input with the shared picker, mapping the min=today
constraint to a react-day-picker before-matcher. Paired open/close TimeSelects
are unchanged. Emits the same YYYY-MM-DD wire."
```

---

### Task 8.11: Replace advanced-filters date inputs (`value-field.tsx`, 4 variants)

**Files:** (Modify: `apps/webapp/app/components/assets/assets-index/advanced-filters/value-field.tsx:2214-2231`, `:2251-2259`, `:2337-2344`)
**Interfaces:** (Consumes: `DateTimePicker`; Produces: four controlled date-only inputs (`_start`, `_end`, single, and per-row `_<index>`) each emitting `YYYY-MM-DD` normalised via `adjustDateToUTC(value, timeZone)` before `setFilter`)

All four are **controlled** date-only inputs whose `onChange` runs `adjustDateToUTC`
before storing. `DateTimePicker.onChange` hands back the same `YYYY-MM-DD` string the
native `event.target.value` gave, so each `handleDateChange`/handler is preserved — only
the change signature adapts from `event` to `next`.

- [ ] **Step 1: Add the import** near the top of `value-field.tsx` (beside `Input`):

```tsx
import { DateTimePicker } from "~/components/shared/date-time-picker";
```

- [ ] **Step 2: Replace the "between" Start/End pair (`:2213-2232`).** `handleDateChange`
      currently expects a `ChangeEvent`; wrap it so the picker's string is adapted into the
      shape those handlers read (`event.target.value`). Add a small adapter helper above the
      return, or inline it. Inline form:

```tsx
<div className="flex max-w-full items-center justify-normal gap-[2px]">
  <DateTimePicker
    label="Start Date"
    hideLabel
    value={localValue[0]}
    onChange={(next) =>
      handleDateChange(0)({
        target: { value: next },
      } as ChangeEvent<HTMLInputElement>)
    }
    className="w-1/2"
    name={`${name}_start`}
  />
  <DateTimePicker
    label="End Date"
    hideLabel
    value={localValue[1]}
    onChange={(next) =>
      handleDateChange(1)({
        target: { value: next },
      } as ChangeEvent<HTMLInputElement>)
    }
    className="w-1/2"
    name={`${name}_end`}
  />
</div>
```

> Note: `commonInputProps` (spread on the native `Input`) carries
> `inputClassName`/`hideLabel`/`label`/`onKeyUp` — the picker does not accept those
> passthroughs, so pass `label`/`hideLabel`/`className` explicitly as above and drop
> the `{...commonInputProps}` spread for these fields. `onKeyUp` (Enter-to-apply) is
> not applicable to the popover picker.

- [ ] **Step 3: Replace the single-date "else" input (`:2250-2260`)**:

```tsx
<DateTimePicker
  label="Date"
  hideLabel
  value={localValue[0]}
  onChange={(next) =>
    handleDateChange(0)({
      target: { value: next },
    } as ChangeEvent<HTMLInputElement>)
  }
  error={combinedError}
  name={name}
  disabled={disabled}
/>
```

- [ ] **Step 4: Replace the `MultiDateInput` row input (`:2337-2344`)**:

```tsx
<DateTimePicker
  label="Date"
  hideLabel
  value={entry.value}
  onChange={(next) =>
    handleDateChange(index)({
      target: { value: next },
    } as ChangeEvent<HTMLInputElement>)
  }
  className="flex-1"
  name={`${name}_${index}`}
/>
```

- [ ] **Step 5: Typecheck.**

```bash
pnpm --filter @shelf/webapp typecheck
```

Expected: no errors (`ChangeEvent` is already imported in this file; keep the `Input`
import only if other non-date branches still use it — they do, e.g. text/number
operators — so leave it).

- [ ] **Step 6: Manual verification.** Dev server → Assets index → Advanced filters →
      add a **date** column filter:

  1. `between` → pick Start + End → confirm both submit and the filtered list is
     correct (each value `adjustDateToUTC`-normalised as before).
  2. single-date operator (e.g. `is`) → pick a date → confirm the filter applies.
  3. `inDates` (multi) → add/remove rows, pick dates → confirm the comma-joined
     UTC-normalised value filters correctly.

- [ ] **Step 7: Commit.**

```bash
git add "apps/webapp/app/components/assets/assets-index/advanced-filters/value-field.tsx"
git commit -m "feat(webapp): use DateTimePicker for advanced date filters

Replace the four native date inputs (between start/end, single, multi-date row)
with the shared picker. Each keeps its controlled adjustDateToUTC(value, timeZone)
normalisation before setFilter; emitted YYYY-MM-DD wire is unchanged."
```

---

**Phase 8 exit check.** After Task 8.11, run the full validation once to confirm the
whole phase is green:

```bash
pnpm webapp:validate
```

Expected: typecheck, lint, prettier, and all unit tests (incl. `time-select.test.ts`
and `date-time-picker.test.tsx`) pass. Kill any lingering vitest watch process
afterward.

---
