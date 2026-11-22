/**
 * The roles & permissions doc embeds a table rendered from the committed
 * effective-access fixture. This fails when the doc no longer matches the
 * fixture: run `pnpm --filter @shelf/webapp docs:roles` and commit the result.
 *
 * @see {@link file://./roles-doc.ts}
 * @see {@link file://../../../../docs/roles-and-permissions.md}
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EffectiveAccessSnapshot } from "./roles-doc";
import {
  ROLES_DOC_BEGIN,
  ROLES_DOC_END,
  renderEffectiveAccessMarkdown,
  replaceGeneratedBlock,
} from "./roles-doc";

// @vitest-environment node

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("roles & permissions doc", () => {
  it("matches the committed fixture", () => {
    const snapshot = JSON.parse(
      read("./__snapshots__/effective-access.json")
    ) as EffectiveAccessSnapshot;
    const doc = read("../../../../docs/roles-and-permissions.md");

    expect(doc).toBe(
      replaceGeneratedBlock(doc, renderEffectiveAccessMarkdown(snapshot))
    );
  });

  it("refuses a doc without the generated-block markers", () => {
    expect(() => replaceGeneratedBlock("# no markers", "x")).toThrow(/markers/);
    expect(ROLES_DOC_BEGIN).not.toBe(ROLES_DOC_END);
  });
});
