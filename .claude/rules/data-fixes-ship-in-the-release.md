---
description: A data fix a release needs ships as a migration or as code, never as a manual SQL step in the deploy notes
---

# Data Fixes Ship In The Release

Self-hosters run the migrations and the new image. They never read a PR's
deploy notes. A step that says "after deploy, run this SQL" is skipped on
every instance but ours, and on ours it depends on someone remembering it.

If the release is wrong without a data change, the release makes the change:

- **A migration**, when the fix is right whenever it runs.
- **Code**, when it depends on something a migration cannot see. For example,
  rows the previous version writes after the migrations ran and before it
  stopped serving: let the new code repair or tolerate them when it meets
  them (on read, or on the setting that makes them matter).

```md
<!-- ❌ Bad: a required step in the PR body -->

3. Right after the deploy, run:
   UPDATE "Booking" SET "approvedAt" = ... WHERE "updatedAt" < '<deploy time>';

<!-- ✅ Good: nothing to run. Turning approval on stamps leftover
     reservations in the same transaction (booking-settings service). -->
```

Deploy notes may still say what a release changes and in what order our own
manual migration runs. They must never carry a step the code needs to be
correct. When you find yourself writing one, stop and move it into a migration
or the code.
