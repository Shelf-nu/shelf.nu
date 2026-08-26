# `displayName` Is The User-Facing Name

`User.displayName` REPLACES `firstName lastName` everywhere a person is named —
lists, badges, notes, emails, exports, PDFs, search, sort. SSO users set it
themselves (`account-details.general` → `updateDisplayName`), and it is the name
they have asked to be called by. Showing the legal name instead is not a
cosmetic bug.

**This class is invisible to every check we run.** A projection that drops
`displayName` still renders a real, plausible name, so no assertion, reviewer or
error can tell right from wrong. Only the person being misnamed notices.

## Never re-list the name fields — pass the row through

The recurring cause is a hand-written projection. Widening a `select` achieves
nothing when a mapper downstream names fields explicitly (see
[[hand-written-projections-drop-relation-fields]]).

```ts
// ❌ Bad — the select already fetched displayName; this throws it away
const user = await getUserByID(userId, {
  select: { id: true, ...USER_NAME_SELECT },
});
wrapUserLinkForNote({
  id: userId,
  firstName: user.firstName,
  lastName: user.lastName,
});

// ✅ Good
wrapUserLinkForNote({ ...user, id: userId });
```

Same for `select` blocks: spread `USER_NAME_SELECT` (`~/modules/user/fields`)
rather than listing `firstName`/`lastName` and hoping the third is remembered.

## The compiler is the guard — keep it armed

`UserNameFields` / `TeamMemberNameFields` (`~/utils/user`) make `displayName`
**required** while the legal-name halves stay optional. That asymmetry is
deliberate: it turns a silent misnaming into a build failure. Pinned by the
`@ts-expect-error` case in `user.test.ts` — if that directive ever goes unused,
someone has made the field optional again.

Never widen a type back to `displayName?:` to clear an error. Fix the source.

## Three places the compiler cannot reach — sweep these by hand

1. **Raw SQL.** `Prisma.sql` is just a string. `modules/asset/query.server.ts`
   builds custodian/creator JSON in SQL; every user object needs
   `'displayName', x."displayName"`, and any name join must be
   `COALESCE(NULLIF(TRIM(x."displayName"), ''), TRIM(CONCAT(...)))`. Selecting a
   column also means adding it to `GROUP BY`. Pinned by SQL-text assertions in
   `query.server.test.ts`.
2. **String joins.** `` `${u.firstName} ${u.lastName}` `` — use
   `resolveUserDisplayName(u)`.
3. **Search and sort.** A name you can see but cannot search for is still a bug.
   Add a `displayName` branch beside every `firstName` predicate.

   For **ordering**, do NOT lead with `{ user: { displayName: "asc" } }`: Prisma
   emits no NULLS clause, so Postgres sorts NULLs last and the list splits into
   two alphabetical blocks — every renamed user above every un-renamed one, with
   a display-name "Zoe" ahead of a fallback "Aaron". Order team members by
   `{ name: "asc" }` instead. `TeamMember.name` is NOT NULL and `updateUser`
   keeps it equal to `displayName` when set and `"firstName lastName"`
   otherwise, so it is already the materialised COALESCE that `orderBy` cannot
   express — and it matches the search path in `api+/model-filters`, so the list
   does not re-sort the moment someone types.

## Which resolver

| Surface                        | Use                                          |
| ------------------------------ | -------------------------------------------- |
| Any full name                  | `resolveUserDisplayName(user)`               |
| A custodian (user OR NRM)      | `resolveTeamMemberName(teamMember)`          |
| An email salutation, "Hey Sam" | `resolveUserGreetingName(user)` — first name |
| A chip in a list               | `<UserBadge user={…}>` / `<TeamMemberBadge>` |

Hand `UserBadge` a `user`, not a pre-formatted `name` — the `name` prop exists
only for rows that carry no user relation.

## Deliberately excluded

- `modules/settings/service.server.ts` renders `"Legal Name (Display Name)"` on
  the team settings page — an intentional admin mapping view.
- `components/user/display-name-form.tsx` uses the legal name as the input
  **placeholder**: it is what the field falls back to.
- `utils/stripe.server.ts` sets the Stripe customer name — billing wants the
  legal name.

## Companion app

`apps/companion/lib/person-name.ts` mirrors this with `formatPersonName()`. The
mobile API payloads carry `displayName`; several companion screens still join
names by hand — tracked in that file's JSDoc. See
[[cross-app-mirrors-need-provenance]].
