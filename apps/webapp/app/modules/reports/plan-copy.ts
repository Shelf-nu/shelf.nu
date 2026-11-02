/**
 * Reports Plan Copy
 *
 * The words a workspace sees when its plan does not include reports. Reports
 * are part of the Plus and Team plans. A Free workspace keeps the Reports menu
 * item: the index and any report URL show the unlock page, and the CSV and PDF
 * downloads answer 403 with the same title.
 *
 * Client-safe: shared by the server gate that throws the 403 and by the unlock
 * page, so both say the same thing. It must never import a `*.server` module.
 *
 * @see {@link file://../../utils/subscription.server.ts} `assertUserCanUseReports`
 * @see {@link file://../../components/reports/unlock-reports-page.tsx}
 */

/** Title of the unlock page and of the 403 the CSV and PDF downloads answer. */
export const REPORTS_PLAN_TITLE = "Reports are part of Plus and Team";

/** Message of the 403 the CSV and PDF downloads answer. */
export const REPORTS_PLAN_MESSAGE =
  "Upgrade this workspace to open reports. Your assets and their data stay available on every plan.";
