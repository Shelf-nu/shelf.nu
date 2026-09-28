/**
 * Renders the effective-access tables in `apps/docs/roles-and-permissions.md`
 * from the committed characterization fixture, so the doc shows exactly what
 * the code grants. `roles-doc.test.ts` fails when the committed doc drifts;
 * `pnpm --filter @shelf/webapp docs:roles` rewrites the block.
 *
 * Imports only relative modules, so `tsx` can run it outside Vite.
 *
 * @see {@link file://../../../scripts/render-roles-doc.ts}
 */
import type { OrganizationRole } from "./role-access";
import { ROLE_LABELS, ROLES_BY_RANK } from "./role-access";

export const ROLES_DOC_BEGIN =
  "<!-- BEGIN GENERATED: effective-access (pnpm --filter @shelf/webapp docs:roles) -->";
export const ROLES_DOC_END = "<!-- END GENERATED: effective-access -->";

/** The fixture keys the doc renders. */
export type EffectiveAccessSnapshot = {
  matrix: Record<string, Record<string, string[]>>;
  "D-01:precedence": OrganizationRole[];
  "D-14": Record<string, Record<string, boolean>>;
  "D-28": Record<string, Record<string, boolean>>;
  "D-21": Record<string, string[]>;
  "D-33": Record<string, string>;
};

const ALL_TOGGLES_ON = "ssB,baB,ssC,baC";
const yesNo = (value: boolean) => (value ? "yes" : "no");

/** A "no value" cell: a word, never a dash, per the doc's own no-dash rule. */
const NONE = "None";

function table(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/**
 * The generated block's body.
 *
 * @param snapshot - The parsed `effective-access.json`
 */
export function renderEffectiveAccessMarkdown(
  snapshot: EffectiveAccessSnapshot
): string {
  const roles = ROLES_BY_RANK;
  const header = ["", ...roles.map((role) => ROLE_LABELS[role])];
  const entities = Object.keys(snapshot.matrix[roles[0]]).sort();

  const matrix = table(
    ["Entity", ...header.slice(1)],
    entities.map((entity) => [
      `\`${entity}\``,
      ...roles.map((role) => snapshot.matrix[role][entity].join(", ") || NONE),
    ])
  );

  const reach = table(header, [
    [
      "Sees every booking (toggles off / on)",
      ...roles.map(
        (role) =>
          `${yesNo(snapshot["D-14"][role].none)} / ${yesNo(
            snapshot["D-14"][role][ALL_TOGGLES_ON]
          )}`
      ),
    ],
    [
      "Sees every custodian (toggles off / on)",
      ...roles.map(
        (role) =>
          `${yesNo(snapshot["D-28"][role].none)} / ${yesNo(
            snapshot["D-28"][role][ALL_TOGGLES_ON]
          )}`
      ),
    ],
    [
      "Removes booking items in",
      ...roles.map((role) => snapshot["D-21"][role].join(", ") || NONE),
    ],
    ["Default asset index", ...roles.map((role) => snapshot["D-33"][role])],
  ]);

  const precedence = snapshot["D-01:precedence"]
    .map((role) => ROLE_LABELS[role])
    .join(" > ");

  return [
    "<!-- prettier-ignore-start -->",
    `**Precedence** (a member holding several roles is judged by the highest): ${precedence}.`,
    "",
    "#### Reach",
    "",
    reach,
    "",
    "#### Permission matrix",
    "",
    matrix,
    "<!-- prettier-ignore-end -->",
  ].join("\n");
}

/**
 * Replaces the generated block in a document.
 *
 * @throws {Error} when either marker is missing
 */
export function replaceGeneratedBlock(doc: string, body: string): string {
  const start = doc.indexOf(ROLES_DOC_BEGIN);
  const end = doc.indexOf(ROLES_DOC_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("roles doc: generated-block markers not found");
  }
  return `${doc.slice(0, start + ROLES_DOC_BEGIN.length)}\n${body}\n${doc.slice(
    end
  )}`;
}
