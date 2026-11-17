---
description: A data fix a release needs ships as a migration, never as a manual SQL step in the deploy notes
---

# Data Fixes Ship In The Release

Self-hosted instances never read a PR's deploy notes. Their container runs
`prisma migrate deploy` at startup (`apps/webapp/docker-entrypoint.sh`) and
nothing else. A step that says "after the deploy, run this SQL" is skipped on
every instance but ours.

If the release is wrong without a data change, the change is a **migration**.

```md
<!-- ❌ Bad: a required step in the PR body -->

3. Right after the deploy, run:
   UPDATE "Booking" SET "approvedAt" = ... WHERE "updatedAt" < '<deploy time>';

<!-- ✅ Good: the backfill is a migration; nothing to run by hand -->
```

**Rows the previous version writes during the deploy are our problem, not a
self-hoster's.** A normal self-hosted upgrade stops the old container before
the new one migrates, so its migration sees every row. Only our production
runs migrations ahead of the deploy while the old version keeps serving.
Before shipping code to repair that window, query production once the old
version has stopped serving: if nothing is left over, there is nothing to
ship. If something is, fix our rows once, by hand, run the query again to
confirm it returns nothing, and say so in the PR.

Deploy notes may still say what a release changes and in what order our own
manual migrations run. They never carry a step another instance needs.
