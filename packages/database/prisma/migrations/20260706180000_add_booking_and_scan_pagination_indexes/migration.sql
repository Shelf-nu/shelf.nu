-- Two composite indexes following the paginate-first pattern established by
-- Asset_organizationId_createdAt_id_idx (see 20260706120000): filter column
-- first, then the sort key in query direction, then id as the pagination
-- tiebreaker, so page selection early-terminates instead of scanning +
-- sorting the whole set.
--
-- 1. Booking: serves the bookings index default view (getBookings):
--      WHERE "organizationId" = ? ORDER BY "from" ASC, "id" ASC LIMIT n
--    Booking previously had only single-column indexes, so every page load
--    scanned and sorted the workspace's entire booking history.
--
-- 2. Scan: serves getScanByQrId (the last-scan card on asset overview and
--    kit detail pages):
--      WHERE "rawQrId" = ? ORDER BY "createdAt" DESC LIMIT 1
--    Scan is a global, append-only table (public QR hits + companion scans,
--    never pruned) with no index on rawQrId, so every one of these page
--    views paid a sequential scan over all scan history. rawQrId seeks the
--    QR; createdAt lets the top-1 sort early-terminate (Postgres walks the
--    btree backwards for DESC, so no explicit direction is needed).
--
-- Locking: plain (non-CONCURRENT) CREATE INDEX, matching repo convention.
-- Both tables build their index in at most a few seconds under the brief
-- lock at current production sizes.

CREATE INDEX IF NOT EXISTS "Booking_organizationId_from_id_idx"
  ON public."Booking" ("organizationId", "from", "id");

CREATE INDEX IF NOT EXISTS "Scan_rawQrId_createdAt_idx"
  ON public."Scan" ("rawQrId", "createdAt");
