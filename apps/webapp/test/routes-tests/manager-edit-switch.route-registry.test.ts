// @vitest-environment node
/**
 * Registry test: every server permission check on a pair "Managers can edit
 * assets" grants is classified by hand.
 *
 * `WORKSPACE_GRANTS.managersCanEditAssets` adds `asset: create, update`,
 * `kit: create, update` and `qr: update` to MANAGER, and every check that
 * reads the workspace's switches follows it. So a new route gated on one of
 * those pairs opens to Managers the day it ships, with no review. This test
 * reads every non-test file under `app/routes` and `app/modules`, finds each
 * check on `PermissionEntity.asset | kit | qr` whose action is `create` or
 * `update` (a single action, an array, or an action the source cannot name
 * statically), and requires its file to be in exactly one list:
 *
 * - `OPENED_BY_SWITCH`: reviewed; Managers may reach it with the switch on.
 * - `MATRIX_ONLY`: must stay closed; every such check passes `matrixOnly: true`.
 *
 * Behaviour per route is pinned in `manager-edit-switch.web-gates.test.ts`.
 *
 * @see {@link file://./../../../../packages/permissions/src/workspace-grants.ts}
 * @see {@link file://./manager-edit-switch.web-gates.test.ts}
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(__dirname, "../../app");
const SCANNED_DIRS = ["routes", "modules"];

/** Files reviewed and allowed to open to a Manager with the switch on. */
const OPENED_BY_SWITCH = [
  "routes/_layout+/assets.$assetId.overview.duplicate.tsx",
  "routes/_layout+/assets.$assetId.overview.manage-placements.tsx",
  "routes/_layout+/assets.$assetId.overview.tsx",
  "routes/_layout+/assets.$assetId.overview.update-location.tsx",
  "routes/_layout+/assets.$assetId.tsx",
  "routes/_layout+/assets.$assetId_.edit.tsx",
  // Bulk delete (asset:delete) and single create; bulk create is matrixOnly.
  "routes/_layout+/assets._index.tsx",
  // Single create opens; `bulk=1` passes matrixOnly in the loader and action.
  "routes/_layout+/assets.new.tsx",
  "routes/_layout+/kits.$kitId.assets.manage-assets.tsx",
  "routes/_layout+/kits.$kitId.assets.tsx",
  "routes/_layout+/kits.$kitId.assets.update-location.tsx",
  "routes/_layout+/kits.$kitId.scan-assets.tsx",
  "routes/_layout+/kits.$kitId.tsx",
  "routes/_layout+/kits.$kitId_.edit.tsx",
  "routes/_layout+/kits._index.tsx",
  "routes/_layout+/kits.new.tsx",
  "routes/_layout+/scanner.tsx",
  "routes/api+/asset.scan.ts",
  "routes/api+/assets.adjust-quantity.ts",
  "routes/api+/assets.bulk-update-location.ts",
  // bulk-update-location (kit:update) opens; bulk-delete is kit:delete.
  "routes/api+/kits.bulk-actions.ts",
  // Names a link stored in an asset's custom field: part of editing values.
  "routes/api+/link-titles.ts",
  "routes/api+/mobile+/asset.adjust-quantity.ts",
  "routes/api+/mobile+/asset.create.ts",
  "routes/api+/mobile+/asset.manage-placements.ts",
  "routes/api+/mobile+/asset.update-image.ts",
  "routes/api+/mobile+/asset.update-location.ts",
  "routes/api+/mobile+/asset.update.ts",
  "routes/api+/mobile+/bulk-update-location.ts",
  "routes/api+/mobile+/kits.bulk-actions.ts",
  "routes/api+/mobile+/qr.claim.ts",
  "routes/api+/mobile+/qr.link-asset.ts",
  "routes/qr+/_private+/$qrId_.claim.tsx",
  "routes/qr+/_private+/$qrId_.link.asset.tsx",
  "routes/qr+/_private+/$qrId_.link.kit.tsx",
  "routes/qr+/_private+/$qrId_.link.tsx",
];

/** Files that share a granted pair but stay closed to a Manager. */
const MATRIX_ONLY = [
  // The sequential id migration prompt: the migration rewrites every asset.
  "routes/_layout+/_layout.tsx",
  "routes/api+/assets.bulk-add-to-kit.ts",
  "routes/api+/assets.bulk-assign-tags.ts",
  "routes/api+/assets.bulk-mark-availability.ts",
  "routes/api+/assets.bulk-remove-from-kits.ts",
  "routes/api+/assets.bulk-update-asset-model.ts",
  "routes/api+/assets.bulk-update-category.ts",
  "routes/api+/assets.bulk-update-custom-field.ts",
  "routes/api+/assets.bulk-update-reorder-point.ts",
  "routes/api+/generate-sequential-ids.tsx",
  // "Fill empty fields" writes the model's defaults to every linked asset.
  "routes/_layout+/settings.asset-models.$assetModelId_.edit.tsx",
];

/** One permission check as written in the source. */
type Check = { entity: string; action: string; matrixOnly: string | null };

/**
 * The object literal around `index`: from the nearest unmatched `{` before it
 * to its matching `}`.
 */
function enclosingObject(src: string, index: number): string {
  let start = index;
  for (let depth = 0; start > 0; ) {
    const char = src[--start];
    if (char === "}") depth++;
    else if (char === "{" && depth-- === 0) break;
  }
  let end = index;
  for (let depth = 0; end < src.length; end++) {
    const char = src[end];
    if (char === "{") depth++;
    else if (char === "}" && depth-- === 0) break;
  }
  return src.slice(start, end + 1);
}

/** Every check on an asset, kit or qr entity in `src`. */
function checksIn(src: string): Check[] {
  return [
    ...src.matchAll(/\bentity:\s*PermissionEntity\.(asset|kit|qr)\b/g),
  ].map((match) => {
    const object = enclosingObject(src, match.index);
    const action = /\baction:\s*(\[[^\]]*\]|[^,\n}]+)/.exec(object)?.[1] ?? "";
    const matrixOnly = /\bmatrixOnly:\s*([^,\n}]+)/.exec(object)?.[1] ?? null;
    return { entity: match[1], action: action.trim(), matrixOnly };
  });
}

/**
 * Whether the switch could open this check: its action names `create` or
 * `update`, or is computed (an intent map) and so cannot be ruled out.
 */
function shareGrantedPair({ entity, action }: Check): boolean {
  const literal = /^(\[\s*)?PermissionAction\.\w+/.test(action);
  if (!literal) return true;
  const actions = [...action.matchAll(/PermissionAction\.(\w+)/g)].map(
    (m) => m[1]
  );
  return entity === "qr"
    ? actions.includes("update")
    : actions.includes("create") || actions.includes("update");
}

/** Granted-pair checks per scanned file, keyed by path under `app/`. */
const GRANTED_CHECKS = new Map<string, Check[]>(
  SCANNED_DIRS.flatMap((dir) =>
    readdirSync(path.join(APP_DIR, dir), { recursive: true })
      .map((entry) => path.join(dir, String(entry)).split(path.sep).join("/"))
      .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\./.test(file))
      .map(
        (file) =>
          [
            file,
            checksIn(readFileSync(path.join(APP_DIR, file), "utf8")).filter(
              shareGrantedPair
            ),
          ] as const
      )
      .filter(([, checks]) => checks.length > 0)
  )
);

describe("manager edit switch: every granted-pair check is classified", () => {
  it("finds the checks (sanity)", () => {
    // A scan that matched nothing would make every assertion below vacuous.
    expect(GRANTED_CHECKS.size).toBeGreaterThan(20);
  });

  it("puts no file in both lists", () => {
    expect(OPENED_BY_SWITCH.filter((f) => MATRIX_ONLY.includes(f))).toEqual([]);
  });

  it("lists only files that still hold a granted-pair check", () => {
    const stale = [...OPENED_BY_SWITCH, ...MATRIX_ONLY].filter(
      (file) => !GRANTED_CHECKS.has(file)
    );
    expect(
      stale,
      "These listed files no longer check asset/kit create|update or " +
        "qr update. Remove them from the lists in this test."
    ).toEqual([]);
  });

  it("classifies every file that checks a granted pair", () => {
    const unclassified = [...GRANTED_CHECKS.keys()].filter(
      (file) => !OPENED_BY_SWITCH.includes(file) && !MATRIX_ONLY.includes(file)
    );
    expect(
      unclassified,
      "These files check a pair that 'Managers can edit assets' grants " +
        "(asset/kit create|update, qr update), so Managers reach them when " +
        "the switch is on. Review each one, then add it to OPENED_BY_SWITCH " +
        "if a Manager may do it, or pass `matrixOnly: true` at every such " +
        "check and add it to MATRIX_ONLY."
    ).toEqual([]);
  });

  it.each(MATRIX_ONLY)(
    "%s passes matrixOnly: true at every granted-pair check",
    (file) => {
      const open = (GRANTED_CHECKS.get(file) ?? []).filter(
        (check) => check.matrixOnly !== "true"
      );
      expect(
        open,
        `${file} must stay closed to Managers: add \`matrixOnly: true\` ` +
          "to these checks, or move the file to OPENED_BY_SWITCH after review."
      ).toEqual([]);
    }
  );
});
