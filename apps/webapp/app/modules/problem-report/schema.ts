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

/** The fewest characters a report may have, after trimming. */
export const PROBLEM_REPORT_MIN_LENGTH = 3;
/** The most characters a report may have, as sent and as stored. */
export const PROBLEM_REPORT_MAX_LENGTH = 1000;

const TOO_LONG = `Keep the description to ${PROBLEM_REPORT_MAX_LENGTH.toLocaleString(
  "en-US"
)} characters or fewer.`;

/**
 * The report text, checked in this order:
 *
 * 1. The text as sent is at most {@link PROBLEM_REPORT_MAX_LENGTH} characters.
 *    This runs first so the delimiter strip, whose work grows with the length
 *    of the text, only ever sees a bounded string.
 * 2. Markdoc delimiters are removed (the text is written into a note that
 *    renders through Markdoc) and the result is trimmed.
 * 3. What is left is {@link PROBLEM_REPORT_MIN_LENGTH} to
 *    {@link PROBLEM_REPORT_MAX_LENGTH} characters, so text that is only
 *    delimiters or spaces is refused.
 */
export const problemReportContentSchema = z
  .string({ required_error: "Describe the problem." })
  .max(PROBLEM_REPORT_MAX_LENGTH, TOO_LONG)
  .transform((value) => stripMarkdocDelimiters(value).trim())
  .pipe(
    z
      .string()
      .min(
        PROBLEM_REPORT_MIN_LENGTH,
        `Describe the problem in at least ${PROBLEM_REPORT_MIN_LENGTH} characters.`
      )
      .max(PROBLEM_REPORT_MAX_LENGTH, TOO_LONG)
  );

/** The web form: the text only, the asset comes from the URL. */
export const ProblemReportFormSchema = z.object({
  content: problemReportContentSchema,
});
