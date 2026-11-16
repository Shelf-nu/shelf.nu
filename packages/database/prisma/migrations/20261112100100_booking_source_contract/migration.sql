-- Booking source contract: deferred constraint triggers that check the final
-- state of every booking slice and every (booking, asset) group a
-- transaction touched.
--
-- How it works:
--
--   * An immediate row trigger on "BookingAsset" records a slice's
--     "sourceAllocation" at its first update that involves a non-LEGACY mode,
--     in the per-transaction temp table pg_temp.booking_source_first_mode.
--     No record means "no earlier non-LEGACY mode".
--   * Deferred constraint triggers on "BookingAssetSource", "BookingAsset",
--     "BookingDispositionShare" and "ConsumptionLog" fire at COMMIT, derive
--     the affected slice ids and group keys from OLD and NEW, ignore NULL
--     keys, and add each key to pg_temp.booking_source_checked. Only the call
--     that adds a key runs its check, so each slice and each group is checked
--     once per transaction, on the final state.
--   * LEGACY fast path: a "BookingAsset" write that is LEGACY before and
--     after, or a booking "ConsumptionLog" write, whose group is unconverted
--     at commit (no non-LEGACY slice, no share row) returns after
--     booking_source_group_is_converted, creating no temp table. That costs
--     per write: one exact probe of "BookingAsset_manual_unique", one probe of
--     "AssetKit_assetId_kitId_key" for the asset's kits plus one exact probe
--     of "BookingAsset_kit_unique" per kit of the asset, and one probe of
--     "BookingDispositionShare_bookingId_assetId_idx"; twice only when an
--     UPDATE moves the row to another (booking, asset) group. The triggers on
--     the two source tables always enqueue.
--   * check_booking_source_slice runs checks 1, 3 to 8 and 10 for one slice;
--     check_booking_source_group runs checks 2, 9 and 10 for one group.
--     A slice that no longer exists is skipped. A group whose booking no
--     longer exists is skipped (deleting a booking removes its shares).
--     A group with no slices left is still checked (orphaned shares).
--
-- Every violation raises 'booking_source_check_<n>: <detail>' with
-- ERRCODE check_violation, n being the contract check number:
--
--    1  no downgrade: a slice that was not LEGACY when the transaction first
--       touched it is not LEGACY at commit; a non-LEGACY slice has
--       "sourcesConvertedAt" set
--    2  group: no LEGACY slice when the group has a non-LEGACY slice or any
--       share row (a group is converted when it has either)
--    3  a LEGACY slice has no source rows
--    4  AUTO/MANUAL: "assetKitId" IS NULL and no KIT row; KIT: "assetKitId"
--       set and exactly one row, of kind KIT; the asset is QUANTITY_TRACKED
--    5  the slice's rows sum to "BookingAsset"."quantity", at least one row
--    6  one organization: source rows, LOCATION rows' locations, shares,
--       their logs' assets, the slice's asset and the booking
--    7  the rows' "dispatchedTotal" sum to "checkedOutQuantity"
--    8  per row: "dispatchedTotal" - sum(shares on the row) = "outQuantity";
--       UNKNOWN: "quantity" = "outQuantity", "releasedQuantity" = 0;
--       UNASSIGNED: "outQuantity" = 0, "dispatchedTotal" = 0, no shares
--    9  converted group: every disposition log (RETURN, CONSUME, LOSS,
--       DAMAGE) is fully shared, sum(share quantity) = log quantity
--   10  share binding: a share's booking and asset are its log's; its slice,
--       when set, is in that group; its source row, when set, belongs to its
--       slice (so a share with no slice names no row); a share on a
--       non-LEGACY slice names a row
--
-- LEGACY groups get checks 1 to 3 only, so writers that know nothing about
-- source rows keep working unchanged on unconverted groups.
--
-- The functions do not set search_path, like the other trigger functions in
-- this schema; the temp tables are always addressed as pg_temp.<name>.

-- Creates the two per-transaction temp tables when the transaction does not
-- have them yet. ON COMMIT DROP removes them after the deferred triggers ran.
CREATE OR REPLACE FUNCTION booking_source_ensure_temp_tables()
RETURNS void AS $$
BEGIN
  IF to_regclass('pg_temp.booking_source_first_mode') IS NULL THEN
    CREATE TEMP TABLE IF NOT EXISTS booking_source_first_mode (
      slice_id text PRIMARY KEY,
      mode     text
    ) ON COMMIT DROP;
  END IF;
  IF to_regclass('pg_temp.booking_source_checked') IS NULL THEN
    CREATE TEMP TABLE IF NOT EXISTS booking_source_checked (
      key text PRIMARY KEY
    ) ON COMMIT DROP;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Immediate row trigger on "BookingAsset" (UPDATE only, and only when the old
-- or new mode is not LEGACY, see the trigger's WHEN): remembers the slice's
-- mode before the first such update. Later updates keep the first value.
-- A LEGACY to non-LEGACY update records 'LEGACY', so a slice converted and
-- reverted inside one transaction is not mistaken for a downgrade.
CREATE OR REPLACE FUNCTION booking_source_record_first_mode()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM booking_source_ensure_temp_tables();
  INSERT INTO pg_temp.booking_source_first_mode (slice_id, mode)
    VALUES (OLD.id, OLD."sourceAllocation"::text)
    ON CONFLICT (slice_id) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Whether a (booking, asset) group is converted: it has a non-LEGACY slice or
-- any share row. Reads only existing indexes, each probe exact: the slice
-- lookup is split on "assetKitId" to match the two partial uniques. The
-- standalone half probes "BookingAsset_manual_unique" ("bookingId",
-- "assetId") WHERE "assetKitId" IS NULL. The kit half takes the asset's
-- AssetKit ids from "AssetKit_assetId_kitId_key" ("assetId", "kitId") and
-- probes "BookingAsset_kit_unique" ("bookingId", "assetKitId") WHERE
-- "assetKitId" IS NOT NULL once per kit, so a booking with many kit slices of
-- other assets costs nothing extra. The share lookup uses
-- "BookingDispositionShare_bookingId_assetId_idx".
CREATE OR REPLACE FUNCTION booking_source_group_is_converted(
  p_booking_id text, p_asset_id text
)
RETURNS boolean AS $$
  SELECT p_booking_id IS NOT NULL AND p_asset_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM "BookingAsset"
      WHERE "bookingId" = p_booking_id AND "assetId" = p_asset_id
        AND "assetKitId" IS NULL
        AND "sourceAllocation" <> 'LEGACY'
    )
    OR EXISTS (
      SELECT 1 FROM "BookingAsset"
      WHERE "bookingId" = p_booking_id
        AND "assetKitId" IN (
          SELECT ak.id FROM "AssetKit" ak WHERE ak."assetId" = p_asset_id
        )
        AND "assetId" = p_asset_id
        AND "sourceAllocation" <> 'LEGACY'
    )
    OR EXISTS (
      SELECT 1 FROM "BookingDispositionShare"
      WHERE "bookingId" = p_booking_id AND "assetId" = p_asset_id
    )
  );
$$ LANGUAGE sql STABLE;

-- Whether a row write touches a converted group: the OLD group for UPDATE and
-- DELETE, the NEW group for INSERT and UPDATE. An UPDATE that keeps the row in
-- the same (booking, asset) group looks it up once.
CREATE OR REPLACE FUNCTION booking_source_write_touches_converted_group(
  p_op text,
  p_old_booking_id text, p_old_asset_id text,
  p_new_booking_id text, p_new_asset_id text
)
RETURNS boolean AS $$
BEGIN
  IF p_op IN ('UPDATE', 'DELETE')
    AND booking_source_group_is_converted(p_old_booking_id, p_old_asset_id)
  THEN
    RETURN true;
  END IF;
  IF p_op = 'INSERT'
    OR (p_op = 'UPDATE'
      AND (p_new_booking_id IS DISTINCT FROM p_old_booking_id
        OR p_new_asset_id IS DISTINCT FROM p_old_asset_id))
  THEN
    RETURN booking_source_group_is_converted(p_new_booking_id, p_new_asset_id);
  END IF;
  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;

-- Check 10 and the share half of check 6 for a set of shares.
CREATE OR REPLACE FUNCTION check_booking_source_shares(p_share_ids text[])
RETURNS void AS $$
DECLARE
  bad record;
BEGIN
  IF p_share_ids IS NULL OR cardinality(p_share_ids) = 0 THEN
    RETURN;
  END IF;

  -- Check 10: the share is bound to its log's group, to a slice of that
  -- group, and to a source row of that slice.
  SELECT v.share_id, v.problem INTO bad
  FROM (
    SELECT
      d.id AS share_id,
      CASE
        WHEN d."bookingId" IS DISTINCT FROM l."bookingId"
          OR d."assetId" <> l."assetId"
          THEN 'its booking or asset differs from its log'
        WHEN d."bookingAssetId" IS NOT NULL
          AND (ba."bookingId" <> d."bookingId" OR ba."assetId" <> d."assetId")
          THEN 'its slice belongs to another booking or asset'
        WHEN d."bookingAssetSourceId" IS NOT NULL
          AND src."bookingAssetId" IS DISTINCT FROM d."bookingAssetId"
          THEN 'its source row does not belong to its slice'
        WHEN d."bookingAssetId" IS NOT NULL
          AND ba."sourceAllocation" <> 'LEGACY'
          AND d."bookingAssetSourceId" IS NULL
          THEN 'it names a converted slice but no source row'
      END AS problem
    FROM "BookingDispositionShare" d
    JOIN "ConsumptionLog" l ON l.id = d."consumptionLogId"
    LEFT JOIN "BookingAsset" ba ON ba.id = d."bookingAssetId"
    LEFT JOIN "BookingAssetSource" src ON src.id = d."bookingAssetSourceId"
    WHERE d.id = ANY (p_share_ids)
  ) v
  WHERE v.problem IS NOT NULL
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'booking_source_check_10: share % is not bound correctly: %',
      bad.share_id, bad.problem USING ERRCODE = 'check_violation';
  END IF;

  -- Check 6: the share and its log's asset are in the booking's organization.
  SELECT d.id AS share_id INTO bad
  FROM "BookingDispositionShare" d
  JOIN "Booking" b ON b.id = d."bookingId"
  JOIN "ConsumptionLog" l ON l.id = d."consumptionLogId"
  JOIN "Asset" la ON la.id = l."assetId"
  WHERE d.id = ANY (p_share_ids)
    AND (d."organizationId" <> b."organizationId"
      OR la."organizationId" <> b."organizationId")
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'booking_source_check_6: share % and its booking are in different organizations',
      bad.share_id USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Checks 1, 3 to 8 and 10 for one slice, on its final state.
CREATE OR REPLACE FUNCTION check_booking_source_slice(p_slice_id text)
RETURNS void AS $$
DECLARE
  slice          record;
  first_mode     text;
  n_rows         int;
  n_kit_rows     int;
  sum_quantity   int;
  sum_dispatched int;
  bad            record;
  share_ids      text[];
BEGIN
  SELECT
    ba.id,
    ba.quantity,
    ba."checkedOutQuantity" AS checked_out,
    ba."assetKitId" AS asset_kit_id,
    ba."sourceAllocation"::text AS mode,
    ba."sourcesConvertedAt" AS converted_at,
    b."organizationId" AS org_id,
    a.type::text AS asset_type,
    a."organizationId" AS asset_org_id
  INTO slice
  FROM "BookingAsset" ba
  JOIN "Booking" b ON b.id = ba."bookingId"
  JOIN "Asset" a ON a.id = ba."assetId"
  WHERE ba.id = p_slice_id;

  -- A removed slice has nothing left to check.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Check 1, before branching on the final mode.
  PERFORM booking_source_ensure_temp_tables();
  SELECT fm.mode INTO first_mode
  FROM pg_temp.booking_source_first_mode fm
  WHERE fm.slice_id = p_slice_id;

  IF first_mode IS NOT NULL AND first_mode <> 'LEGACY' AND slice.mode = 'LEGACY' THEN
    RAISE EXCEPTION 'booking_source_check_1: slice % went from % to LEGACY; a converted slice never returns to LEGACY',
      p_slice_id, first_mode USING ERRCODE = 'check_violation';
  END IF;
  IF slice.mode <> 'LEGACY' AND slice.converted_at IS NULL THEN
    RAISE EXCEPTION 'booking_source_check_1: slice % is % but has no sourcesConvertedAt',
      p_slice_id, slice.mode USING ERRCODE = 'check_violation';
  END IF;

  -- Check 3: a LEGACY slice has no source rows, and nothing else applies.
  IF slice.mode = 'LEGACY' THEN
    IF EXISTS (
      SELECT 1 FROM "BookingAssetSource" WHERE "bookingAssetId" = p_slice_id
    ) THEN
      RAISE EXCEPTION 'booking_source_check_3: LEGACY slice % has source rows',
        p_slice_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE s.kind = 'KIT'),
    COALESCE(sum(s.quantity), 0),
    COALESCE(sum(s."dispatchedTotal"), 0)
  INTO n_rows, n_kit_rows, sum_quantity, sum_dispatched
  FROM "BookingAssetSource" s
  WHERE s."bookingAssetId" = p_slice_id;

  -- Check 4: the mode matches the slice's kit link and its rows' kinds.
  IF slice.asset_type <> 'QUANTITY_TRACKED' THEN
    RAISE EXCEPTION 'booking_source_check_4: slice % is % but its asset is not QUANTITY_TRACKED',
      p_slice_id, slice.mode USING ERRCODE = 'check_violation';
  END IF;
  IF slice.mode = 'KIT' THEN
    IF slice.asset_kit_id IS NULL THEN
      RAISE EXCEPTION 'booking_source_check_4: KIT slice % has no assetKitId',
        p_slice_id USING ERRCODE = 'check_violation';
    END IF;
    IF n_rows <> 1 OR n_kit_rows <> 1 THEN
      RAISE EXCEPTION 'booking_source_check_4: KIT slice % must have exactly one row, of kind KIT (has % rows, % KIT)',
        p_slice_id, n_rows, n_kit_rows USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF slice.asset_kit_id IS NOT NULL THEN
      RAISE EXCEPTION 'booking_source_check_4: % slice % has an assetKitId',
        slice.mode, p_slice_id USING ERRCODE = 'check_violation';
    END IF;
    IF n_kit_rows > 0 THEN
      RAISE EXCEPTION 'booking_source_check_4: % slice % has a KIT row',
        slice.mode, p_slice_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Check 5: the rows plan exactly the booked quantity.
  IF n_rows = 0 OR sum_quantity <> slice.quantity THEN
    RAISE EXCEPTION 'booking_source_check_5: slice % has % rows summing to %, booked quantity is %',
      p_slice_id, n_rows, sum_quantity, slice.quantity USING ERRCODE = 'check_violation';
  END IF;

  -- Check 6: the slice's asset, its rows and their locations are in the
  -- booking's organization.
  IF slice.asset_org_id <> slice.org_id
    OR EXISTS (
      SELECT 1
      FROM "BookingAssetSource" s
      LEFT JOIN "Location" loc ON loc.id = s."locationId"
      WHERE s."bookingAssetId" = p_slice_id
        AND (s."organizationId" <> slice.org_id
          OR (loc.id IS NOT NULL AND loc."organizationId" <> slice.org_id))
    )
  THEN
    RAISE EXCEPTION 'booking_source_check_6: slice % has an asset, source row or location outside its booking organization',
      p_slice_id USING ERRCODE = 'check_violation';
  END IF;

  -- Check 7: every unit checked out on the slice was dispatched from a row.
  IF sum_dispatched <> slice.checked_out THEN
    RAISE EXCEPTION 'booking_source_check_7: slice % rows dispatched %, checkedOutQuantity is %',
      p_slice_id, sum_dispatched, slice.checked_out USING ERRCODE = 'check_violation';
  END IF;

  -- Check 8: reconciliation invariant and kind rules on every row.
  SELECT s.id, s.kind::text AS kind, s.quantity, s."outQuantity" AS out_quantity,
         s."releasedQuantity" AS released_quantity,
         s."dispatchedTotal" AS dispatched_total,
         sh.shared, sh.n_shares
  INTO bad
  FROM "BookingAssetSource" s
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(d.quantity), 0) AS shared, count(*) AS n_shares
    FROM "BookingDispositionShare" d
    WHERE d."bookingAssetSourceId" = s.id
  ) sh
  WHERE s."bookingAssetId" = p_slice_id
    AND (
      s."dispatchedTotal" - sh.shared <> s."outQuantity"
      OR (s.kind = 'UNKNOWN'
        AND (s.quantity <> s."outQuantity" OR s."releasedQuantity" <> 0))
      OR (s.kind = 'UNASSIGNED'
        AND (s."outQuantity" <> 0 OR s."dispatchedTotal" <> 0 OR sh.n_shares > 0))
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'booking_source_check_8: % row % (quantity %, out %, released %, dispatched %, shared %) breaks the reconciliation invariant or its kind rules',
      bad.kind, bad.id, bad.quantity, bad.out_quantity, bad.released_quantity,
      bad.dispatched_total, bad.shared USING ERRCODE = 'check_violation';
  END IF;

  -- Check 10 (and the share half of 6) for every share naming this slice or
  -- one of its rows.
  SELECT array_agg(x.id) INTO share_ids
  FROM (
    SELECT d.id
    FROM "BookingDispositionShare" d
    WHERE d."bookingAssetId" = p_slice_id
    UNION
    SELECT d.id
    FROM "BookingDispositionShare" d
    JOIN "BookingAssetSource" s ON s.id = d."bookingAssetSourceId"
    WHERE s."bookingAssetId" = p_slice_id
  ) x;

  PERFORM check_booking_source_shares(share_ids);
END;
$$ LANGUAGE plpgsql;

-- Checks 2, 9 and 10 for one (booking, asset) group, on its final state.
CREATE OR REPLACE FUNCTION check_booking_source_group(p_booking_id text, p_asset_id text)
RETURNS void AS $$
DECLARE
  bad       record;
  share_ids text[];
BEGIN
  -- Deleting a booking removes its shares; its logs need no reconciliation.
  IF NOT EXISTS (SELECT 1 FROM "Booking" WHERE id = p_booking_id) THEN
    RETURN;
  END IF;

  -- An unconverted (LEGACY) group has nothing more to check.
  IF NOT booking_source_group_is_converted(p_booking_id, p_asset_id) THEN
    RETURN;
  END IF;

  -- Check 2: a converted group has no LEGACY slice.
  IF EXISTS (
    SELECT 1 FROM "BookingAsset"
    WHERE "bookingId" = p_booking_id AND "assetId" = p_asset_id
      AND "sourceAllocation" = 'LEGACY'
  ) THEN
    RAISE EXCEPTION 'booking_source_check_2: converted group (booking %, asset %) has a LEGACY slice',
      p_booking_id, p_asset_id USING ERRCODE = 'check_violation';
  END IF;

  -- Check 9: every disposition log of the group is fully shared.
  SELECT l.id, l.quantity, COALESCE(sum(d.quantity), 0) AS shared
  INTO bad
  FROM "ConsumptionLog" l
  LEFT JOIN "BookingDispositionShare" d ON d."consumptionLogId" = l.id
  WHERE l."bookingId" = p_booking_id
    AND l."assetId" = p_asset_id
    AND l.category IN ('RETURN', 'CONSUME', 'LOSS', 'DAMAGE')
  GROUP BY l.id, l.quantity
  HAVING COALESCE(sum(d.quantity), 0) <> l.quantity
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'booking_source_check_9: log % of group (booking %, asset %) has quantity % but shares of %',
      bad.id, p_booking_id, p_asset_id, bad.quantity, bad.shared
      USING ERRCODE = 'check_violation';
  END IF;

  -- Check 10 (and the share half of 6) for every share of the group.
  SELECT array_agg(d.id) INTO share_ids
  FROM "BookingDispositionShare" d
  WHERE d."bookingId" = p_booking_id AND d."assetId" = p_asset_id;

  PERFORM check_booking_source_shares(share_ids);
END;
$$ LANGUAGE plpgsql;

-- Adds a slice to the checked set; the call that adds it runs its check.
CREATE OR REPLACE FUNCTION booking_source_enqueue_slice(p_slice_id text)
RETURNS void AS $$
DECLARE
  added int;
BEGIN
  IF p_slice_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM booking_source_ensure_temp_tables();
  INSERT INTO pg_temp.booking_source_checked (key)
    VALUES ('slice:' || p_slice_id)
    ON CONFLICT (key) DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;
  IF added > 0 THEN
    PERFORM check_booking_source_slice(p_slice_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Adds a group to the checked set; the call that adds it runs its check.
CREATE OR REPLACE FUNCTION booking_source_enqueue_group(p_booking_id text, p_asset_id text)
RETURNS void AS $$
DECLARE
  added int;
BEGIN
  IF p_booking_id IS NULL OR p_asset_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM booking_source_ensure_temp_tables();
  INSERT INTO pg_temp.booking_source_checked (key)
    VALUES ('group:' || p_booking_id || ':' || p_asset_id)
    ON CONFLICT (key) DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;
  IF added > 0 THEN
    PERFORM check_booking_source_group(p_booking_id, p_asset_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Enqueues a slice and, when the slice still exists, its group. A removed
-- slice's group is enqueued by the slice's own delete.
CREATE OR REPLACE FUNCTION booking_source_enqueue_slice_and_group(p_slice_id text)
RETURNS void AS $$
DECLARE
  slice_booking_id text;
  slice_asset_id   text;
BEGIN
  IF p_slice_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM booking_source_enqueue_slice(p_slice_id);
  SELECT "bookingId", "assetId" INTO slice_booking_id, slice_asset_id
  FROM "BookingAsset" WHERE id = p_slice_id;
  IF FOUND THEN
    PERFORM booking_source_enqueue_group(slice_booking_id, slice_asset_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Enqueues the slice (and group) owning a source row, looked up from the row
-- itself so a share cannot hide which slice its source row belongs to.
CREATE OR REPLACE FUNCTION booking_source_enqueue_source_parent(p_source_id text)
RETURNS void AS $$
DECLARE
  parent_slice_id text;
BEGIN
  IF p_source_id IS NULL THEN
    RETURN;
  END IF;
  SELECT "bookingAssetId" INTO parent_slice_id
  FROM "BookingAssetSource" WHERE id = p_source_id;
  IF FOUND THEN
    PERFORM booking_source_enqueue_slice_and_group(parent_slice_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Deferred trigger on "BookingAssetSource": the parent slice and its group.
CREATE OR REPLACE FUNCTION booking_source_contract_on_source()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM booking_source_enqueue_slice_and_group(OLD."bookingAssetId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM booking_source_enqueue_slice_and_group(NEW."bookingAssetId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Deferred trigger on "BookingAsset": the slice itself and its group.
--
-- LEGACY fast path: a write whose old and new modes are both LEGACY, in a
-- group that is unconverted at commit, cannot break the contract, so it
-- returns before touching any temp table. Such a slice can only fail check 1
-- (impossible: it was LEGACY when written) or check 3 (a source row insert
-- enqueues its slice through the source trigger); checks 2 and 9 pass for an
-- unconverted group, and the other checks apply to converted slices only.
CREATE OR REPLACE FUNCTION booking_source_contract_on_booking_asset()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR OLD."sourceAllocation" = 'LEGACY')
    AND (TG_OP = 'DELETE' OR NEW."sourceAllocation" = 'LEGACY')
    AND NOT booking_source_write_touches_converted_group(
      TG_OP, OLD."bookingId", OLD."assetId", NEW."bookingId", NEW."assetId"
    )
  THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM booking_source_enqueue_slice(OLD.id);
    PERFORM booking_source_enqueue_group(OLD."bookingId", OLD."assetId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM booking_source_enqueue_slice(NEW.id);
    PERFORM booking_source_enqueue_group(NEW."bookingId", NEW."assetId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Deferred trigger on "BookingDispositionShare": the share's slice, the
-- parent slice of its source row (looked up independently), their groups,
-- and the share's own group.
CREATE OR REPLACE FUNCTION booking_source_contract_on_share()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM booking_source_enqueue_slice_and_group(OLD."bookingAssetId");
    PERFORM booking_source_enqueue_source_parent(OLD."bookingAssetSourceId");
    PERFORM booking_source_enqueue_group(OLD."bookingId", OLD."assetId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM booking_source_enqueue_slice_and_group(NEW."bookingAssetId");
    PERFORM booking_source_enqueue_source_parent(NEW."bookingAssetSourceId");
    PERFORM booking_source_enqueue_group(NEW."bookingId", NEW."assetId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Enqueues a booking log's group and, for each of its shares, the share's
-- slice, the parent slice of its source row, their groups and the share's
-- own group.
CREATE OR REPLACE FUNCTION booking_source_enqueue_log(
  p_log_id text, p_booking_id text, p_asset_id text
)
RETURNS void AS $$
DECLARE
  log_share record;
BEGIN
  IF p_booking_id IS NULL OR p_asset_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM booking_source_enqueue_group(p_booking_id, p_asset_id);
  FOR log_share IN
    SELECT d."bookingAssetId" AS slice_id,
           d."bookingAssetSourceId" AS source_id,
           d."bookingId" AS booking_id,
           d."assetId" AS asset_id
    FROM "BookingDispositionShare" d
    WHERE d."consumptionLogId" = p_log_id
  LOOP
    PERFORM booking_source_enqueue_slice_and_group(log_share.slice_id);
    PERFORM booking_source_enqueue_source_parent(log_share.source_id);
    PERFORM booking_source_enqueue_group(log_share.booking_id, log_share.asset_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Deferred trigger on "ConsumptionLog". The triggers below fire only for
-- logs with a booking (WHEN on the row values), so the many logs written
-- outside bookings queue no event at all.
--
-- LEGACY fast path: a log whose old and new groups are both unconverted at
-- commit returns before touching any temp table. Checks 9 and 10 apply to
-- converted groups only, and the log can have no valid shares: a share
-- carries its log's group, which would make that group converted.
CREATE OR REPLACE FUNCTION booking_source_contract_on_log()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT booking_source_write_touches_converted_group(
    TG_OP, OLD."bookingId", OLD."assetId", NEW."bookingId", NEW."assetId"
  ) THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM booking_source_enqueue_log(OLD.id, OLD."bookingId", OLD."assetId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM booking_source_enqueue_log(NEW.id, NEW."bookingId", NEW."assetId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Immediate: records a slice's mode at its first update that involves a
-- non-LEGACY mode. LEGACY to LEGACY updates and inserts record nothing; check 1
-- treats a missing record as "no earlier mode", which is exact for them (a
-- LEGACY first mode can never fail check 1). Deletes record nothing: a
-- deleted slice is skipped by its check.
CREATE TRIGGER booking_asset_source_first_mode
  AFTER UPDATE ON "BookingAsset"
  FOR EACH ROW
  WHEN (OLD."sourceAllocation" <> 'LEGACY' OR NEW."sourceAllocation" <> 'LEGACY')
  EXECUTE FUNCTION booking_source_record_first_mode();

-- Deferred: the contract checks, on final state at COMMIT.
CREATE CONSTRAINT TRIGGER booking_source_contract_source
  AFTER INSERT OR UPDATE OR DELETE ON "BookingAssetSource"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION booking_source_contract_on_source();

CREATE CONSTRAINT TRIGGER booking_source_contract_booking_asset
  AFTER INSERT OR UPDATE OR DELETE ON "BookingAsset"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION booking_source_contract_on_booking_asset();

CREATE CONSTRAINT TRIGGER booking_source_contract_share
  AFTER INSERT OR UPDATE OR DELETE ON "BookingDispositionShare"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION booking_source_contract_on_share();

-- A WHEN clause cannot name OLD on INSERT or NEW on DELETE, so the log
-- trigger is one per event. Each condition reads only the row being written.
CREATE CONSTRAINT TRIGGER booking_source_contract_log_insert
  AFTER INSERT ON "ConsumptionLog"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW."bookingId" IS NOT NULL)
  EXECUTE FUNCTION booking_source_contract_on_log();

CREATE CONSTRAINT TRIGGER booking_source_contract_log_update
  AFTER UPDATE ON "ConsumptionLog"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."bookingId" IS NOT NULL OR NEW."bookingId" IS NOT NULL)
  EXECUTE FUNCTION booking_source_contract_on_log();

CREATE CONSTRAINT TRIGGER booking_source_contract_log_delete
  AFTER DELETE ON "ConsumptionLog"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."bookingId" IS NOT NULL)
  EXECUTE FUNCTION booking_source_contract_on_log();
