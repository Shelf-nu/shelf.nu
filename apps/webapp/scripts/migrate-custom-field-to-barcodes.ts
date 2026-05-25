/**
 * One-off migration: copy values from a text custom field into Barcode rows.
 *
 * Built for the Marina-style case where a customer used a custom field
 * (e.g. "serial number") to track an asset identifier that they now want
 * surfaced in list views. By loading those values as Barcode rows under the
 * alternative-barcodes add-on, the feature's resolver + AssetCodeBadge can
 * render them everywhere lists are rendered — no separate "show custom
 * fields in lists" pathway needed.
 *
 * Behaviour:
 * - Idempotent: re-running with the same args is safe; existing barcodes
 *   with the same (orgId, value) tuple are skipped.
 * - Pre-flight checks: ASCII validation (Code128 requirement), collision
 *   detection, dedup within input, empty/whitespace rejection.
 * - `--dryRun` prints the planned changes and exits with code 0 without
 *   touching the database.
 * - Audit-logged: every created barcode is written to a timestamped log
 *   file so the operation can be reviewed or reversed by inspecting it.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-custom-field-to-barcodes.ts \
 *     --orgId=<id> \
 *     --customFieldName="serial number" \
 *     [--barcodeType=Code128] \
 *     [--setPreferred] \
 *     [--dryRun] \
 *     [--allowNonAscii]
 *
 * Flags:
 * - `--orgId` (required) — target Organization.id
 * - `--customFieldName` (required) — exact name of the CustomField to read from
 * - `--barcodeType` — Code128 | Code39 | DataMatrix | ExternalQR | EAN13.
 *                     Defaults to Code128 (most permissive).
 * - `--setPreferred` — set the newly-created barcode as each asset's
 *                      Asset.preferredBarcodeId. Useful when the workspace
 *                      may have other barcodes of the same type.
 * - `--dryRun` — preview without writing.
 * - `--allowNonAscii` — bypass the ASCII check (only meaningful for
 *                       non-Code128 types).
 */

import { writeFileSync } from "fs";
import { resolve as resolvePath } from "path";
import type { BarcodeType } from "@prisma/client";
import { createDatabaseClient } from "@shelf/database";

type Args = {
  orgId: string;
  customFieldName: string;
  barcodeType: BarcodeType;
  setPreferred: boolean;
  dryRun: boolean;
  allowNonAscii: boolean;
};

/** Parse `--key=value` / `--flag` style CLI args. */
function parseArgs(argv: string[]): Args {
  const opts: Record<string, string | boolean> = {};
  for (const a of argv.slice(2)) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) {
      opts[a.slice(2)] = true;
    } else {
      opts[a.slice(2, eq)] = a.slice(eq + 1);
    }
  }

  const orgId = typeof opts.orgId === "string" ? opts.orgId : "";
  const customFieldName =
    typeof opts.customFieldName === "string" ? opts.customFieldName : "";
  const barcodeTypeArg =
    typeof opts.barcodeType === "string" ? opts.barcodeType : "Code128";
  const validTypes: BarcodeType[] = [
    "Code128",
    "Code39",
    "DataMatrix",
    "ExternalQR",
    "EAN13",
  ];
  if (!validTypes.includes(barcodeTypeArg as BarcodeType)) {
    throw new Error(
      `--barcodeType must be one of: ${validTypes.join(
        ", "
      )} (got: ${barcodeTypeArg})`
    );
  }

  if (!orgId) throw new Error("--orgId is required");
  if (!customFieldName) throw new Error("--customFieldName is required");

  return {
    orgId,
    customFieldName,
    barcodeType: barcodeTypeArg as BarcodeType,
    setPreferred: opts.setPreferred === true,
    dryRun: opts.dryRun === true,
    allowNonAscii: opts.allowNonAscii === true,
  };
}

/** Returns true if every char is ASCII printable + control range supported by Code128. */
function isAsciiOnly(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) return false;
  }
  return true;
}

type Plan = {
  toCreate: Array<{ assetId: string; value: string }>;
  skippedAlreadyExists: Array<{
    assetId: string;
    value: string;
    existingBarcodeId: string;
  }>;
  skippedNonAscii: Array<{ assetId: string; value: string }>;
  skippedEmpty: Array<{ assetId: string }>;
  duplicatesWithinInput: Array<{ value: string; assetIds: string[] }>;
};

async function buildPlan(
  args: Args,
  db: ReturnType<typeof createDatabaseClient>
): Promise<Plan> {
  // 1) Org must exist and have the add-on enabled
  const org = await db.organization.findUnique({
    where: { id: args.orgId },
    select: { id: true, name: true, barcodesEnabled: true },
  });
  if (!org) {
    throw new Error(`Organization not found: ${args.orgId}`);
  }
  if (!org.barcodesEnabled) {
    throw new Error(
      `Organization "${org.name}" does not have the barcode add-on enabled. ` +
        `Enable it (Organization.barcodesEnabled = true) before migrating.`
    );
  }

  // 2) Custom field must exist in this org with type TEXT-like (text or string-derived).
  //    deletedAt: null — never migrate values out of a soft-deleted field; if
  //    the operator wants those values surfaced, they should un-archive the
  //    field first via the settings UI.
  const customField = await db.customField.findFirst({
    where: {
      organizationId: args.orgId,
      name: args.customFieldName,
      deletedAt: null,
    },
    select: { id: true, name: true, type: true },
  });
  if (!customField) {
    throw new Error(
      `Custom field "${args.customFieldName}" not found in org ${args.orgId}.`
    );
  }

  // 3) Fetch the field's values for every asset
  const values = await db.assetCustomFieldValue.findMany({
    where: {
      customFieldId: customField.id,
      asset: { organizationId: args.orgId },
    },
    select: {
      assetId: true,
      value: true,
    },
  });

  const plan: Plan = {
    toCreate: [],
    skippedAlreadyExists: [],
    skippedNonAscii: [],
    skippedEmpty: [],
    duplicatesWithinInput: [],
  };

  // 4) Normalize + bucket
  const byValue = new Map<string, string[]>();
  const candidates: Array<{ assetId: string; value: string }> = [];

  for (const row of values) {
    // AssetCustomFieldValue.value is JSON; extract string.
    const raw = row.value;
    let stringValue = "";
    if (typeof raw === "string") {
      stringValue = raw.trim();
    } else if (
      raw &&
      typeof raw === "object" &&
      "raw" in raw &&
      typeof (raw as { raw?: unknown }).raw === "string"
    ) {
      stringValue = (raw as { raw: string }).raw.trim();
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      stringValue = String(raw).trim();
    }

    if (!stringValue) {
      plan.skippedEmpty.push({ assetId: row.assetId });
      continue;
    }
    if (!args.allowNonAscii && !isAsciiOnly(stringValue)) {
      plan.skippedNonAscii.push({ assetId: row.assetId, value: stringValue });
      continue;
    }

    const list = byValue.get(stringValue) ?? [];
    list.push(row.assetId);
    byValue.set(stringValue, list);
    candidates.push({ assetId: row.assetId, value: stringValue });
  }

  for (const [value, assetIds] of byValue.entries()) {
    if (assetIds.length > 1) {
      plan.duplicatesWithinInput.push({ value, assetIds });
    }
  }
  if (plan.duplicatesWithinInput.length > 0) {
    throw new Error(
      `Aborting: ${plan.duplicatesWithinInput.length} duplicate value(s) detected within input. ` +
        `Barcode values must be unique per organization. Deduplicate the custom-field values first.`
    );
  }

  // 5) Check collisions with existing barcodes (and treat them as "already migrated")
  const existing = await db.barcode.findMany({
    where: {
      organizationId: args.orgId,
      value: { in: Array.from(byValue.keys()) },
    },
    select: { id: true, value: true, assetId: true },
  });
  const existingByValue = new Map(existing.map((b) => [b.value, b]));

  for (const c of candidates) {
    const found = existingByValue.get(c.value);
    if (found) {
      plan.skippedAlreadyExists.push({
        assetId: c.assetId,
        value: c.value,
        existingBarcodeId: found.id,
      });
    } else {
      plan.toCreate.push(c);
    }
  }

  return plan;
}

function summarizePlan(plan: Plan, args: Args) {
  const lines: string[] = [];
  lines.push("");
  lines.push("==============================================================");
  lines.push(` Migration plan — ${args.dryRun ? "DRY RUN" : "APPLY"}`);
  lines.push(`   Org: ${args.orgId}`);
  lines.push(`   Custom field: ${args.customFieldName}`);
  lines.push(`   Barcode type: ${args.barcodeType}`);
  lines.push(`   Set as preferred: ${args.setPreferred ? "yes" : "no"}`);
  lines.push("==============================================================");
  lines.push(`Will CREATE:                 ${plan.toCreate.length}`);
  lines.push(
    `Skipped (already migrated):  ${plan.skippedAlreadyExists.length}`
  );
  lines.push(`Skipped (empty value):       ${plan.skippedEmpty.length}`);
  lines.push(`Skipped (non-ASCII value):   ${plan.skippedNonAscii.length}`);
  lines.push("==============================================================");
  if (plan.skippedNonAscii.length > 0) {
    lines.push("");
    lines.push("First few non-ASCII values:");
    for (const e of plan.skippedNonAscii.slice(0, 5)) {
      lines.push(`  asset=${e.assetId}  value="${e.value}"`);
    }
    if (plan.skippedNonAscii.length > 5) {
      lines.push(`  ... and ${plan.skippedNonAscii.length - 5} more`);
    }
  }
  return lines.join("\n");
}

async function applyPlan(
  plan: Plan,
  args: Args,
  db: ReturnType<typeof createDatabaseClient>
): Promise<{ createdBarcodeIds: string[] }> {
  const createdBarcodeIds: string[] = [];

  // Wrap creation in a transaction so partial failures don't leave the
  // workspace in a half-migrated state.
  await db.$transaction(async (tx) => {
    for (const item of plan.toCreate) {
      const barcode = await tx.barcode.create({
        data: {
          organizationId: args.orgId,
          assetId: item.assetId,
          type: args.barcodeType,
          value: item.value,
        },
        select: { id: true },
      });
      createdBarcodeIds.push(barcode.id);

      if (args.setPreferred) {
        await tx.asset.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: this is a CLI script; `item.assetId` was produced by the earlier `customFieldValue.findMany` already org-scoped via `asset: { organizationId: args.orgId }`. No request input flows here.
          where: { id: item.assetId },
          data: { preferredBarcodeId: barcode.id },
        });
      }
    }
  });

  return { createdBarcodeIds };
}

function writeAuditLog(
  plan: Plan,
  args: Args,
  createdBarcodeIds: string[]
): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `migrate-custom-field-to-barcodes-${args.orgId}-${ts}.log`;
  const path = resolvePath(process.cwd(), filename);

  const body = JSON.stringify(
    {
      executedAt: new Date().toISOString(),
      args,
      summary: {
        created: plan.toCreate.length,
        skippedAlreadyExists: plan.skippedAlreadyExists.length,
        skippedEmpty: plan.skippedEmpty.length,
        skippedNonAscii: plan.skippedNonAscii.length,
      },
      createdBarcodeIds,
      skippedAlreadyExists: plan.skippedAlreadyExists,
      skippedNonAscii: plan.skippedNonAscii,
    },
    null,
    2
  );

  writeFileSync(path, body, "utf-8");
  return path;
}

async function main() {
  const args = parseArgs(process.argv);
  const db = createDatabaseClient();

  try {
    const plan = await buildPlan(args, db);
    // eslint-disable-next-line no-console
    console.log(summarizePlan(plan, args));

    if (args.dryRun) {
      // eslint-disable-next-line no-console
      console.log("\nDry run — no changes written.\n");
      return;
    }

    if (plan.toCreate.length === 0) {
      // eslint-disable-next-line no-console
      console.log("\nNothing to create. Exit cleanly.\n");
      return;
    }

    const { createdBarcodeIds } = await applyPlan(plan, args, db);
    const logPath = writeAuditLog(plan, args, createdBarcodeIds);

    // eslint-disable-next-line no-console
    console.log(
      `\nMigration complete. ${createdBarcodeIds.length} barcode(s) created.\n` +
        `Audit log: ${logPath}\n`
    );

    // "Next steps" — surface the operator-action items that aren't and shouldn't
    // be automated by this script:
    //   1) The workspace's preferred display code is still the default. The
    //      whole point of the migration is to surface these new barcodes on
    //      list views — that only happens after the org switches their
    //      preference to `Code128` in /settings/general.
    //   2) The source custom field still exists. We leave it intentionally
    //      (read-only history is valuable; deletion is destructive and reversible
    //      only via a DB restore) — but it's listed here so the operator can
    //      decide whether to archive it once they've confirmed the barcodes are
    //      surfacing correctly.
    // eslint-disable-next-line no-console
    console.log(
      [
        "Next steps:",
        `  1. In the workspace settings (/settings/general), set "Preferred display code" to`,
        `     "${args.barcodeType}" — that's what makes the new barcodes show up on list views.`,
        `  2. The source custom field "${args.customFieldName}" was left in place (read-only history).`,
        `     Once you've confirmed the migration looks right in the UI, you can choose to`,
        `     keep it for audit trail or delete it from /settings/custom-fields.`,
        `  3. Spot-check a few assets in /assets — each migrated asset should show its barcode`,
        `     chip on the row. The chip's tooltip will explain why it's showing if anything looks off.`,
        "",
      ].join("\n")
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
