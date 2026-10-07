/**
 * Regenerates the effective-access block of apps/docs/roles-and-permissions.md
 * from the committed fixture. Run after a fixture change:
 * `pnpm --filter @shelf/webapp docs:roles`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EffectiveAccessSnapshot } from "../app/utils/permissions/roles-doc";
import {
  renderEffectiveAccessMarkdown,
  replaceGeneratedBlock,
} from "../app/utils/permissions/roles-doc";

const fixturePath = fileURLToPath(
  new URL(
    "../app/utils/permissions/__snapshots__/effective-access.json",
    import.meta.url
  )
);
const docPath = fileURLToPath(
  new URL("../../docs/roles-and-permissions.md", import.meta.url)
);

const snapshot = JSON.parse(
  readFileSync(fixturePath, "utf8")
) as EffectiveAccessSnapshot;
const doc = readFileSync(docPath, "utf8");
writeFileSync(
  docPath,
  replaceGeneratedBlock(doc, renderEffectiveAccessMarkdown(snapshot))
);
console.log(`Updated ${docPath}`);
