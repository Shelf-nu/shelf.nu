/**
 * Custom-field definition form schema.
 *
 * Shared by the create and edit routes, so a rule added here holds for both.
 *
 * An OPTION field's options are what an operator can choose from. With none, the
 * dropdown has nothing in it, and if the field is also required, the asset form
 * demands a value that cannot be picked, so no asset can be saved at all.
 *
 * @see {@link file://./form.tsx}
 * @see {@link file://./../../routes/_layout+/settings.custom-fields.new.tsx}
 * @see {@link file://./../../routes/_layout+/settings.custom-fields.$fieldId_.edit.tsx}
 */
import { describe, expect, it } from "vitest";

import { CustomFieldSubmissionSchema } from "./form";

describe("CustomFieldSubmissionSchema", () => {
  const base = { name: "Size", organizationId: "org-1" };

  it("rejects an OPTION field with no options", () => {
    const result = CustomFieldSubmissionSchema.safeParse({
      ...base,
      type: "OPTION",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an OPTION field whose only options are blank", () => {
    // `OptionBuilder` gates on a truthy string and never trims, so a
    // whitespace-only entry reaches the schema and would render an
    // unselectable row in the dropdown.
    const result = CustomFieldSubmissionSchema.safeParse({
      ...base,
      type: "OPTION",
      options: ["   ", ""],
    });

    expect(result.success).toBe(false);
  });

  it("accepts an OPTION field with one real option, trimmed", () => {
    const result = CustomFieldSubmissionSchema.safeParse({
      ...base,
      type: "OPTION",
      options: [" Large "],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.options).toEqual(["Large"]);
    }
  });

  it("drops blank options but keeps the real ones", () => {
    const result = CustomFieldSubmissionSchema.safeParse({
      ...base,
      type: "OPTION",
      options: ["Small", "  ", "Large"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.options).toEqual(["Small", "Large"]);
    }
  });

  it("accepts a non-OPTION field with no options", () => {
    const result = CustomFieldSubmissionSchema.safeParse({
      ...base,
      type: "TEXT",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a non-OPTION field even if options were submitted", () => {
    // Switching the type picker away from OPTION leaves the hidden inputs in
    // the DOM, so stray options arrive with a TEXT field. They are not the
    // operator's intent and must not fail the submission.
    const result = CustomFieldSubmissionSchema.safeParse({
      ...base,
      type: "TEXT",
      options: ["leftover"],
    });

    expect(result.success).toBe(true);
  });
});
