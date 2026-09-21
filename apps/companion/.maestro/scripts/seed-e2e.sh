#!/usr/bin/env bash
set -euo pipefail

#############################################################################
# E2E fixture seeder
#
# `up` / `down` — book-by-model fulfil fixture.
# Creates (or tears down) a reproducible RESERVED booking that reserves 2
# units of a dedicated AssetModel, with two concrete units whose QR ids are
# known — the exact state the fulfil-and-check-out flow needs. Writes the
# resulting ids to `.maestro/env/e2e.env` as SHELF_TEST_* vars so the Maestro
# flows can consume them (see flows/bookings/14-*).
#
# WHY THIS EXISTS: the fulfil scanner needs a model whose unit QR ids you
# KNOW so you can scan them. The picker-driven flow 13 can't (it reserves
# whatever model the picker surfaces), so fulfil coverage needs a fixture.
# Before this, the state was hand-seeded with ad-hoc psql every run.
#
# `scan-checkout-up` / `scan-checkout-down` — scan-to-check-out fixture for
# flows/bookings/19-*: a RESERVED booking holding a two-asset kit's members and
# one more asset as standalone rows, plus an asset the booking does not hold.
# Fixed ids and QR codes, so the QR ids the flow scans never change. Writes
# them to `.maestro/env/e2e-scan-checkout.env`. Re-running `scan-checkout-up`
# resets every fixture asset to AVAILABLE, which a previous run leaves out.
#
# Usage:
#   ./seed-e2e.sh up                  # fulfil fixture, write env/e2e.env
#   ./seed-e2e.sh down                # remove it
#   ./seed-e2e.sh scan-checkout-up    # flow 19 fixture, write env/e2e-scan-checkout.env
#   ./seed-e2e.sh scan-checkout-down  # remove it
#
# Targets the workspace named "$WORKSPACE" (default "GRANULAR WORKSPACE").
# Reads the DB connection from the monorepo-root .env (DIRECT_URL), or from
# $DATABASE_URL if set. QA DB only — never point this at production.
#############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAESTRO_DIR="$(dirname "$SCRIPT_DIR")"
MONO_ROOT="$(cd "$MAESTRO_DIR/../../.." && pwd)"
ENV_OUT="$MAESTRO_DIR/env/e2e.env"
WORKSPACE="${WORKSPACE:-GRANULAR WORKSPACE}"

# Stable ids so `down` is idempotent and re-running `up` is a no-op-then-create.
MODEL_ID="e2e_fulfil_model"
BOOKING_NAME="E2E Fulfil Booking"

# Scan-to-check-out fixture. Every id is cuid-shaped (a leading "c"): the
# partial-checkout endpoint validates assetIds with zod `.cuid()` and refuses any
# other shape before the booking is touched.
SCAN_ENV_OUT="$MAESTRO_DIR/env/e2e-scan-checkout.env"
SCAN_BOOKING_ID="ce2escanchkbooking0001"
SCAN_BOOKING_NAME="E2E Scan Checkout Booking"
SCAN_KIT_ID="ce2escanchkkit00000001"
SCAN_ALPHA="ce2escanchkalpha000001"   # kit member
SCAN_BRAVO="ce2escanchkbravo000001"   # kit member
SCAN_CHARLIE="ce2escanchkcharlie0001" # on the booking, scanned on its own
SCAN_DELTA="ce2escanchkdelta000001"   # never added to the booking
SCAN_KIT_QR="e2eskchkqr01"
SCAN_CHARLIE_QR="e2eskchkqra3"
SCAN_DELTA_QR="e2eskchkqra4"

DB="${DATABASE_URL:-}"
if [ -z "$DB" ]; then
  # `|| true` inside the subshell so a missing .env / absent DIRECT_URL falls
  # through to the friendly error below instead of `set -euo pipefail` aborting
  # from the failed grep before it's reached.
  DB=$( { grep -m1 '^DIRECT_URL=' "$MONO_ROOT/.env" 2>/dev/null || true; } | cut -d= -f2- | tr -d '"'"'"'' | sed 's/?.*//')
fi
if [ -z "$DB" ]; then
  echo "✗ No DB connection. Set DATABASE_URL or add DIRECT_URL to $MONO_ROOT/.env" >&2
  exit 1
fi

psql_q() { psql "$DB" -v ON_ERROR_STOP=1 -tA "$@"; }

ORG_ID=$(psql_q -c "select id from \"Organization\" where name='${WORKSPACE}' limit 1;")
if [ -z "$ORG_ID" ]; then
  echo "✗ Workspace '${WORKSPACE}' not found in this DB." >&2
  exit 1
fi

cmd="${1:-}"
case "$cmd" in
  up)
    # Two available INDIVIDUAL assets in the workspace that carry a QR — these
    # become the model's concrete units, and a THIRD stays model-free as the
    # "outsider" the fulfil flow scans to prove extras are counted separately.
    # Fails loudly if the workspace lacks three, rather than seeding a fixture
    # whose extras assertion can't run.
    # Portable line-into-array read (macOS ships bash 3.2, which lacks mapfile).
    ELIGIBLE=()
    while IFS= read -r _id; do
      [ -n "$_id" ] && ELIGIBLE+=("$_id")
    done < <(psql_q -c "
      select a.id from \"Asset\" a
      join \"Qr\" q on q.\"assetId\"=a.id
      where a.\"organizationId\"='${ORG_ID}'
        and a.\"assetModelId\" is null
      order by a.\"createdAt\" desc limit 3;")
    if [ "${#ELIGIBLE[@]}" -lt 3 ]; then
      echo "✗ Need 3 model-free assets with a QR in '${WORKSPACE}' (2 model units + 1 outsider); found ${#ELIGIBLE[@]}." >&2
      exit 1
    fi
    ASSET_A="${ELIGIBLE[0]}"; ASSET_B="${ELIGIBLE[1]}"; ASSET_OUTSIDER="${ELIGIBLE[2]}"

    OWNER_ID=$(psql_q -c "select \"userId\" from \"UserOrganization\" where \"organizationId\"='${ORG_ID}' and 'OWNER'=any(roles) limit 1;")

    psql "$DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
DELETE FROM "BookingModelRequest" r USING "Booking" b
  WHERE r."bookingId"=b.id AND b.name='${BOOKING_NAME}' AND b."organizationId"='${ORG_ID}';
DELETE FROM "Booking" WHERE name='${BOOKING_NAME}' AND "organizationId"='${ORG_ID}';
UPDATE "Asset" SET "assetModelId"=NULL WHERE "assetModelId"='${MODEL_ID}';
DELETE FROM "AssetModel" WHERE id='${MODEL_ID}';

INSERT INTO "AssetModel" (id,name,"organizationId","userId","createdAt","updatedAt")
VALUES ('${MODEL_ID}','E2E Fulfil Model','${ORG_ID}','${OWNER_ID}',NOW(),NOW());
UPDATE "Asset" SET "assetModelId"='${MODEL_ID}' WHERE id IN ('${ASSET_A}','${ASSET_B}');

INSERT INTO "Booking" (id,name,status,"organizationId","creatorId","custodianUserId",
                       "from","to","createdAt","updatedAt")
VALUES ('e2e_fulfil_booking','${BOOKING_NAME}','RESERVED','${ORG_ID}','${OWNER_ID}','${OWNER_ID}',
        NOW()+interval '1 hour', NOW()+interval '1 day', NOW(), NOW());
INSERT INTO "BookingModelRequest" (id,"bookingId","assetModelId",quantity,"createdAt","updatedAt","fulfilledQuantity")
VALUES ('e2e_fulfil_req','e2e_fulfil_booking','${MODEL_ID}',2,NOW(),NOW(),0);
COMMIT;
SQL

    QR_A=$(psql_q -c "select id from \"Qr\" where \"assetId\"='${ASSET_A}' limit 1;")
    QR_B=$(psql_q -c "select id from \"Qr\" where \"assetId\"='${ASSET_B}' limit 1;")
    # The outsider is the reserved 3rd eligible asset — guaranteed model-free
    # and never assigned above, so this QR is always present.
    OUTSIDER=$(psql_q -c "select id from \"Qr\" where \"assetId\"='${ASSET_OUTSIDER}' limit 1;")

    mkdir -p "$MAESTRO_DIR/env"
    cat > "$ENV_OUT" <<ENV
# Generated by seed-e2e.sh — book-by-model fulfil fixture. Do not edit by hand.
# SHELF_TEST_WORKSPACE mirrors the seeded workspace so the flow selects the same
# one (seed-e2e.sh honours a WORKSPACE override; the flow must follow it).
SHELF_TEST_WORKSPACE=${WORKSPACE}
SHELF_TEST_MODEL_BOOKING_NAME=${BOOKING_NAME}
SHELF_TEST_MODEL_UNIT_QR_A=${QR_A}
SHELF_TEST_MODEL_UNIT_QR_B=${QR_B}
SHELF_TEST_MODEL_OUTSIDER_QR=${OUTSIDER}
ENV
    echo "✓ Seeded '${BOOKING_NAME}' (RESERVED, 2 units of E2E Fulfil Model) in '${WORKSPACE}'."
    echo "  unit A QR: ${QR_A}   unit B QR: ${QR_B}   outsider QR: ${OUTSIDER}"
    echo "  wrote $ENV_OUT"
    ;;
  down)
    psql "$DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
DELETE FROM "BookingModelRequest" WHERE id='e2e_fulfil_req';
DELETE FROM "Booking" WHERE id='e2e_fulfil_booking';
UPDATE "Asset" SET "assetModelId"=NULL WHERE "assetModelId"='${MODEL_ID}';
DELETE FROM "AssetModel" WHERE id='${MODEL_ID}';
COMMIT;
SQL
    rm -f "$ENV_OUT"
    echo "✓ Removed book-by-model fulfil fixture from '${WORKSPACE}'."
    ;;
  scan-checkout-up)
    OWNER_ID=$(psql_q -c "select \"userId\" from \"UserOrganization\" where \"organizationId\"='${ORG_ID}' and 'OWNER'=any(roles) limit 1;")
    OWNER_TM=$(psql_q -c "select id from \"TeamMember\" where \"userId\"='${OWNER_ID}' and \"organizationId\"='${ORG_ID}' and \"deletedAt\" is null limit 1;")
    # Deleting and recreating resets the assets to AVAILABLE and drops the
    # previous run's check-out sessions and slices: every child row of the
    # booking, the assets and the kit cascades.
    psql "$DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
DELETE FROM "Booking" WHERE id='${SCAN_BOOKING_ID}';
DELETE FROM "Qr" WHERE id IN ('${SCAN_KIT_QR}','${SCAN_CHARLIE_QR}','${SCAN_DELTA_QR}');
DELETE FROM "Kit" WHERE id='${SCAN_KIT_ID}';
DELETE FROM "Asset" WHERE id IN ('${SCAN_ALPHA}','${SCAN_BRAVO}','${SCAN_CHARLIE}','${SCAN_DELTA}');

INSERT INTO "Asset" (id,title,"organizationId","userId","updatedAt") VALUES
  ('${SCAN_ALPHA}','E2E Checkout Alpha','${ORG_ID}','${OWNER_ID}',NOW()),
  ('${SCAN_BRAVO}','E2E Checkout Bravo','${ORG_ID}','${OWNER_ID}',NOW()),
  ('${SCAN_CHARLIE}','E2E Checkout Charlie','${ORG_ID}','${OWNER_ID}',NOW()),
  ('${SCAN_DELTA}','E2E Checkout Delta','${ORG_ID}','${OWNER_ID}',NOW());
INSERT INTO "Kit" (id,name,"organizationId","createdById","updatedAt")
VALUES ('${SCAN_KIT_ID}','E2E Scan Checkout Kit','${ORG_ID}','${OWNER_ID}',NOW());
INSERT INTO "AssetKit" (id,"assetId","kitId","organizationId","updatedAt") VALUES
  ('${SCAN_KIT_ID}_alpha','${SCAN_ALPHA}','${SCAN_KIT_ID}','${ORG_ID}',NOW()),
  ('${SCAN_KIT_ID}_bravo','${SCAN_BRAVO}','${SCAN_KIT_ID}','${ORG_ID}',NOW());
INSERT INTO "Qr" (id,"kitId","assetId","organizationId","userId","updatedAt") VALUES
  ('${SCAN_KIT_QR}','${SCAN_KIT_ID}',NULL,'${ORG_ID}','${OWNER_ID}',NOW()),
  ('${SCAN_CHARLIE_QR}',NULL,'${SCAN_CHARLIE}','${ORG_ID}','${OWNER_ID}',NOW()),
  ('${SCAN_DELTA_QR}',NULL,'${SCAN_DELTA}','${ORG_ID}','${OWNER_ID}',NOW());

-- Started an hour ago, so checking out prompts no early check-out.
INSERT INTO "Booking" (id,name,status,"organizationId","creatorId","custodianUserId",
                       "custodianTeamMemberId","from","to","updatedAt")
VALUES ('${SCAN_BOOKING_ID}','${SCAN_BOOKING_NAME}','RESERVED','${ORG_ID}','${OWNER_ID}',
        '${OWNER_ID}',NULLIF('${OWNER_TM}',''),NOW()-interval '1 hour',NOW()+interval '1 day',NOW());
-- The kit's members as STANDALONE rows (assetKitId NULL): the shape the
-- phone's scan-to-add path produces, which the flow depends on.
INSERT INTO "BookingAsset" (id,"bookingId","assetId") VALUES
  ('${SCAN_BOOKING_ID}_alpha','${SCAN_BOOKING_ID}','${SCAN_ALPHA}'),
  ('${SCAN_BOOKING_ID}_bravo','${SCAN_BOOKING_ID}','${SCAN_BRAVO}'),
  ('${SCAN_BOOKING_ID}_charlie','${SCAN_BOOKING_ID}','${SCAN_CHARLIE}');
COMMIT;
SQL

    mkdir -p "$MAESTRO_DIR/env"
    cat > "$SCAN_ENV_OUT" <<ENV
# Generated by seed-e2e.sh scan-checkout-up. Do not edit by hand.
SHELF_TEST_CHECKOUT_KIT_QR_ID=${SCAN_KIT_QR}
SHELF_TEST_CHECKOUT_ASSET_QR_ID=${SCAN_CHARLIE_QR}
SHELF_TEST_OFF_BOOKING_QR_ID=${SCAN_DELTA_QR}
ENV
    echo "✓ Seeded '${SCAN_BOOKING_NAME}' (RESERVED; kit members + 1 asset, standalone) in '${WORKSPACE}'."
    echo "  wrote $SCAN_ENV_OUT"
    ;;
  scan-checkout-down)
    psql "$DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
DELETE FROM "Booking" WHERE id='${SCAN_BOOKING_ID}';
DELETE FROM "Qr" WHERE id IN ('${SCAN_KIT_QR}','${SCAN_CHARLIE_QR}','${SCAN_DELTA_QR}');
DELETE FROM "Kit" WHERE id='${SCAN_KIT_ID}';
DELETE FROM "Asset" WHERE id IN ('${SCAN_ALPHA}','${SCAN_BRAVO}','${SCAN_CHARLIE}','${SCAN_DELTA}');
COMMIT;
SQL
    rm -f "$SCAN_ENV_OUT"
    echo "✓ Removed the scan-to-check-out fixture from '${WORKSPACE}'."
    ;;
  *)
    echo "Usage: $0 up|down|scan-checkout-up|scan-checkout-down" >&2
    exit 1
    ;;
esac
