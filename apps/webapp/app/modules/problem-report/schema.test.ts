/**
 * The problem report text rule shared by the web dialog, the web action and
 * the mobile route.
 *
 * @see {@link file://./schema.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as MarkdocSanitize from "~/utils/markdoc-sanitize";

const strip = vi.hoisted(() => ({ calls: 0 }));

// why: counts calls to the real strip, to show an over-long text is refused
// before the strip runs on it
vi.mock("~/utils/markdoc-sanitize", async (importOriginal) => {
  const actual = await importOriginal<typeof MarkdocSanitize>();
  return {
    ...actual,
    stripMarkdocDelimiters: (raw: string | null | undefined) => {
      strip.calls += 1;
      return actual.stripMarkdocDelimiters(raw);
    },
  };
});

import {
  PROBLEM_REPORT_MAX_LENGTH,
  problemReportContentSchema,
} from "./schema";

/** Delimiters nested `depth` deep: the strip peels one level per pass. */
function nestedDelimiters(depth: number) {
  return `${"{".repeat(depth)}%x%${"}".repeat(depth)}`;
}

describe("problemReportContentSchema", () => {
  beforeEach(() => {
    strip.calls = 0;
  });

  it("refuses text over the limit as sent, before stripping it", () => {
    const result = problemReportContentSchema.safeParse(
      nestedDelimiters(200_000)
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Keep the description to 1,000 characters or fewer."
    );
    expect(strip.calls).toBe(0);
  });

  it("accepts text exactly at the limit", () => {
    const result = problemReportContentSchema.safeParse(
      "x".repeat(PROBLEM_REPORT_MAX_LENGTH)
    );

    expect(result.success).toBe(true);
  });

  it("refuses text one character over the limit", () => {
    const result = problemReportContentSchema.safeParse(
      "x".repeat(PROBLEM_REPORT_MAX_LENGTH + 1)
    );

    expect(result.success).toBe(false);
  });

  it("strips delimiters and trims text within the limit", () => {
    expect(problemReportContentSchema.parse("  Lens {%cracked%}  ")).toBe(
      "Lens cracked"
    );
    expect(strip.calls).toBe(1);
  });

  it("refuses text that is only delimiters and spaces", () => {
    const result = problemReportContentSchema.safeParse("  {% %}  ");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Describe the problem in at least 3 characters."
    );
  });
});
