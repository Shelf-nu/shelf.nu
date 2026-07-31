import Markdoc from "@markdoc/markdoc";
import { describe, it, expect } from "vitest";
import { stripMarkdocDelimiters } from "./markdoc-sanitize";

/** Tag nodes Markdoc finds in a string — the thing an injection must not produce. */
const tagsIn = (content: string) =>
  [...Markdoc.parse(content).walk()].filter((node) => node.type === "tag");

describe("stripMarkdocDelimiters", () => {
  it("removes tag delimiters and trims", () => {
    // The delimiters go; the spaces that surrounded them remain.
    expect(
      stripMarkdocDelimiters('evil {% audit_images ids="stolen" /%} text')
    ).toBe('evil  audit_images ids="stolen" / text');
    expect(stripMarkdocDelimiters("  hello  ")).toBe("hello");
  });

  it("treats nullish input as empty rather than throwing", () => {
    // Call sites splice optional fields (an unset booking name, a missing
    // title); a sanitizer that throws would break the mutation it guards.
    expect(stripMarkdocDelimiters(null)).toBe("");
    expect(stripMarkdocDelimiters(undefined)).toBe("");
  });

  it("leaves legitimate text untouched", () => {
    // Only the `{%` / `%}` pairs go — a lone brace or percent is harmless and
    // real names contain them ("50% off", "{draft}").
    expect(stripMarkdocDelimiters("Dent on the top-left corner")).toBe(
      "Dent on the top-left corner"
    );
    expect(stripMarkdocDelimiters("50% off {new}")).toBe("50% off {new}");
  });

  describe("cannot be defeated by doubling the delimiters", () => {
    // Regression: a single `.replace()` pass splices the surviving characters
    // together into a NEW delimiter, so `{{% … /%}}` came out the other side as
    // a working `{% … /%}` tag — the sanitizer manufactured the payload it was
    // supposed to remove.
    it("does not re-form an opening delimiter", () => {
      expect(stripMarkdocDelimiters("{{%%")).toBe("");
    });

    it("yields no tag for a doubled-delimiter payload", () => {
      const payload = '{{%% link to="javascript:alert(1)" text="x" /%%}}';

      const sanitized = stripMarkdocDelimiters(payload);

      expect(sanitized).not.toContain("{%");
      expect(sanitized).not.toContain("%}");
      expect(tagsIn(sanitized)).toHaveLength(0);
    });

    it("holds for arbitrarily nested delimiters", () => {
      const payload = '{{{%%% link to="https://evil.com" text="x" /%%%}}}';

      expect(tagsIn(stripMarkdocDelimiters(payload))).toHaveLength(0);
    });
  });

  it("produces no tag nodes for a plain injected payload", () => {
    const payload = '{% link to="javascript:alert(1)" text="x" /%}';

    expect(tagsIn(payload)).toHaveLength(1); // sanity: the raw payload IS a tag
    expect(tagsIn(stripMarkdocDelimiters(payload))).toHaveLength(0);
  });
});
