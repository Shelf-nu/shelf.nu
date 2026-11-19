/**
 * Problem Report Schema
 *
 * The one rule for what a member may send with "Report a problem", shared by
 * the web dialog, the web action and the mobile route so all three accept and
 * refuse the same text.
 *
 * @see {@link file://./service.server.ts}
 */
import { z } from "zod";
import { stripMarkdocDelimiters } from "~/utils/markdoc-sanitize";

export const PROBLEM_REPORT_MIN_LENGTH = 3;
export const PROBLEM_REPORT_MAX_LENGTH = 1000;

/**
 * The report text: Markdoc delimiters removed (it is written into a note that
 * renders through Markdoc), trimmed, then held to the length limits. The limits
 * apply to what is stored, so text that is only delimiters is refused.
 */
export const problemReportContentSchema = z
  .string({ required_error: "Describe the problem." })
  .transform((value) => stripMarkdocDelimiters(value).trim())
  .pipe(
    z
      .string()
      .min(
        PROBLEM_REPORT_MIN_LENGTH,
        `Describe the problem in at least ${PROBLEM_REPORT_MIN_LENGTH} characters.`
      )
      .max(
        PROBLEM_REPORT_MAX_LENGTH,
        `Keep the description under ${PROBLEM_REPORT_MAX_LENGTH.toLocaleString(
          "en-US"
        )} characters.`
      )
  );

/** The web form: the text only, the asset comes from the URL. */
export const ProblemReportFormSchema = z.object({
  content: problemReportContentSchema,
});
