# Real Database Tests

Most webapp tests mock Prisma. Some behaviour only exists inside PostgreSQL:
deferred constraint triggers that fire at `COMMIT`, check constraints, grants
and revokes on the Supabase roles. Those tests run against a real, migrated
database and are named `*.db.test.ts`.

## Where things live

| File                                                       | Purpose                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/webapp/vitest.db.config.ts`                          | Vitest config for `test/db/**/*.db.test.ts`                      |
| `apps/webapp/test/db/global-setup.ts`                      | Name guard, Supabase roles, `prisma migrate deploy`              |
| `apps/webapp/test/db/setup-env.ts`                         | Placeholder app env, database URLs set to the test URL           |
| `apps/webapp/test/db/client.ts`                            | `getTestDb()`, `withRollback()`, `commitAndExpect()`             |
| `apps/webapp/test/db/fixtures.ts`                          | `seedOrgWithPool()`, `seedBooking()`                             |
| `apps/webapp/test/db/harness.db.test.ts`                   | Self-test proving the harness works                              |
| `apps/webapp/test/db/booking-sources-rollout.db.test.ts`   | Rollout compatibility: pre-deploy-1 writes, mixed adoption flags |
| `apps/webapp/test/db/booking-sources-benchmark.db.test.ts` | Booking sources benchmark, opt-in with `RUN_BENCHMARKS=1`        |
| `apps/webapp/test/db/fixtures-large.ts`                    | Large fixture the benchmark builds (bulk inserts)                |

The main suite (`pnpm webapp:test`) excludes `test/db/**`, so these files
never run without a database. Older `*.db.test.ts` files under `app/` gate
themselves with `describe.skipIf` on their own database URL and are run by
path through the main config.

## The `_test` guard

Every entry point reads `TEST_DATABASE_URL` and refuses to run unless the
database name in it ends in `_test`. `shelf_test` passes; `postgres`, `shelf`
or a Supabase project URL do not. The guard runs before anything connects, so a
mistyped URL cannot migrate or write to your development or production
database.

The test run also points `DATABASE_URL` and `DIRECT_URL` at the test database,
so any module that reaches the app's own `db` client lands there too.

## Running locally

Use a throwaway database. Any PostgreSQL 15 works, for example a container:

```bash
docker run --rm -d --name shelf-test-db -p 55432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=shelf_test postgres:15.8

TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/shelf_test \
  pnpm webapp:test:db

docker stop shelf-test-db
```

You can also create a `shelf_test` database next to your local Supabase
database. Never point `TEST_DATABASE_URL` at a database you care about: tests
that use `commitAndExpect` commit rows.

Global setup does three things before the tests run:

1. Checks the `_test` suffix.
2. Creates the `anon` and `authenticated` roles if they are missing. Supabase
   has them; plain PostgreSQL does not. Migrations grant and revoke on these
   roles, which fails when a role is absent, so the setup creates them first.
3. Runs `prisma migrate deploy` with the `@shelf/database` schema. Migrations
   already applied are skipped, so reruns are fast.

## Writing a test

```ts
import { commitAndExpect, withRollback } from "./client";
import { seedOrgWithPool } from "./fixtures";

it("rolls back", async () => {
  await withRollback(async (tx) => {
    const { assetId } = await seedOrgWithPool(tx, {
      total: 10,
      placements: [{ name: "Shelf A", quantity: 4 }],
    });
    // assertions against tx
  });
});

it("reports a deferred trigger", async () => {
  const result = await commitAndExpect(async (tx) => {
    // writes that a deferred trigger rejects at COMMIT
  });
  expect(result.ok).toBe(false);
});
```

- `withRollback(fn)` runs `fn` in a transaction and always rolls it back. Use
  it by default. Deferred triggers never fire inside it.
- `commitAndExpect(fn)` really commits, so deferred triggers fire. It returns
  `{ ok: true }` or `{ ok: false, message }`. Rows from a successful commit
  stay; fixtures randomise unique values so reruns do not collide.

Files run one at a time (`fileParallelism: false`) because they share one
database.

## CI

The `🗄️ Database tests` job in `.github/workflows/test.yml` starts a
`postgres:15.8` service container with `POSTGRES_DB=shelf_test`, sets
`TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shelf_test`,
installs dependencies, generates the Prisma client and runs
`pnpm webapp:test:db`. It uses no secrets, so it runs on fork pull requests
like the rest of that workflow.

## Benchmarks

`booking-sources-benchmark.db.test.ts` is skipped unless `RUN_BENCHMARKS=1`,
so `pnpm webapp:test:db` and the regular CI run never pay for it. It builds two
copies of a large workspace (`fixtures-large.ts`): 20 locations, 500 pools
placed at every location, three 500-slice bookings (reserved, ongoing, draft),
1000 competing bookings and 50 long-lived bookings with heavy return history.
One copy stays LEGACY; the other is converted through the real check-in entry
points.

Each operation (booking details, reserve, scan-add, partial check-out,
check-in, bulk location delete, bulk booking delete, asset delete, kit quantity
change, conversion) runs on both copies: LEGACY data with adoption off, which
is today's behaviour, against converted data with adoption on. A write sample
runs in a transaction that ends with `SET CONSTRAINTS ALL IMMEDIATE`, so the
deferred contract triggers are part of the time, and is then rolled back, so
every sample starts from the same data.

The CI log gets:

- a table of medians, min and max per arm and the difference in percent;
- `EXPLAIN (ANALYZE, BUFFERS)` of every distinct statement the operations send,
  of the foreign key lookups on the new tables, and of the delete statements
  with their cascades, ready to paste into a PR.

It fails when a stable operation (spread at most 30% on both arms, legacy
median at least 20 ms) is more than 10% slower with booking sources, or when
partial check-out or a conversion takes half the 15 s check-out transaction
timeout or more. Unstable or very small differences are printed, not asserted.

### Running it in CI

The benchmark is a separate step of the `🗄️ Database tests` job. It runs when:

- the `🧪 Test` workflow is started by hand (Actions tab, "Run workflow") with
  `run_benchmarks` ticked. GitHub only offers this once the workflow file with
  that input is on `main`; or
- the pull request carries the `run-benchmarks` label. The label is read from
  the event that started the run, so add it and then push a commit. A re-run of
  an older run does not see a label added later.

The job timeout rises from 20 to 75 minutes when the benchmark runs.

### Running it locally

Only against a throwaway `*_test` database, as above:

```bash
RUN_BENCHMARKS=1 \
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/shelf_test \
  pnpm --filter @shelf/webapp exec vitest --run --config vitest.db.config.ts \
  test/db/booking-sources-benchmark.db.test.ts
```

Timings on a laptop are only good for comparing the two arms with each other.
