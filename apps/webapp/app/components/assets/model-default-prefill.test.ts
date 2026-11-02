/**
 * Tests for the asset form's model default pre-fill.
 *
 * The plan is pure: given what the form shows and the model picked, it says
 * what each input should now show. These tests drive it the way the form does,
 * picking a model, typing, then picking another, and check the user's input is
 * never replaced.
 *
 * @see {@link file://./model-default-prefill.ts}
 */
import type { CustomField } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { ModelPrefill, PrefillModel } from "./model-default-prefill";
import {
  EMPTY_MODEL_PREFILL,
  VALUATION_PREFILL_KEY,
  getUsablePrefill,
  planModelPrefill,
  prefillVersion,
} from "./model-default-prefill";

/** Model A: a valuation and a Brand default. */
const modelA: PrefillModel = {
  defaultValuation: 450,
  customFieldDefaults: [
    {
      customFieldId: "brand",
      value: { raw: "Westermo", valueOption: "Westermo" },
    },
  ],
};

/** Model B: different values for the same inputs. */
const modelB: PrefillModel = {
  defaultValuation: 900,
  customFieldDefaults: [
    {
      customFieldId: "brand",
      value: { raw: "Siemens", valueOption: "Siemens" },
    },
  ],
};

/**
 * Plans a pick against a form whose inputs hold `form`. A key missing from
 * `form` is an input that is not rendered.
 */
function pick({
  previous = EMPTY_MODEL_PREFILL,
  model,
  form,
  savedKeys = [],
}: {
  previous?: ModelPrefill;
  model: PrefillModel | undefined;
  form: Record<string, string>;
  savedKeys?: string[];
}) {
  return planModelPrefill({
    previous,
    model,
    readCurrent: (key) => (key in form ? form[key] : null),
    savedKeys: new Set(savedKeys),
  });
}

describe("planModelPrefill", () => {
  it("fills empty inputs with the model's defaults", () => {
    const next = pick({ model: modelA, form: { valuation: "", brand: "" } });

    expect(next.values).toEqual({
      [VALUATION_PREFILL_KEY]: "450",
      brand: "Westermo",
    });
    expect(prefillVersion(next, VALUATION_PREFILL_KEY)).toBe(1);
    expect(prefillVersion(next, "brand")).toBe(1);
  });

  it("leaves inputs the user typed in", () => {
    const next = pick({
      model: modelA,
      form: { valuation: "12", brand: "Siemens" },
    });

    expect(next.values).toEqual({});
    expect(prefillVersion(next, VALUATION_PREFILL_KEY)).toBe(0);
    expect(prefillVersion(next, "brand")).toBe(0);
  });

  it("replaces model A's untouched values when switching to model B", () => {
    const afterA = pick({ model: modelA, form: { valuation: "", brand: "" } });

    const afterB = pick({
      previous: afterA,
      model: modelB,
      form: { valuation: "450", brand: "Westermo" },
    });

    expect(afterB.values).toEqual({
      [VALUATION_PREFILL_KEY]: "900",
      brand: "Siemens",
    });
    expect(prefillVersion(afterB, "brand")).toBe(2);
  });

  it("keeps a value the user edited after model A filled it, also on later picks", () => {
    const afterA = pick({ model: modelA, form: { valuation: "", brand: "" } });

    // The user changed Brand after A filled it, then picked B.
    const afterB = pick({
      previous: afterA,
      model: modelB,
      form: { valuation: "450", brand: "Moxa" },
    });

    expect(afterB.values).toEqual({ [VALUATION_PREFILL_KEY]: "900" });
    expect(prefillVersion(afterB, "brand")).toBe(1);

    // Picking A again does not reclaim the edited Brand either.
    const afterAAgain = pick({
      previous: afterB,
      model: modelA,
      form: { valuation: "900", brand: "Moxa" },
    });

    expect(afterAAgain.values).toEqual({ [VALUATION_PREFILL_KEY]: "450" });
    expect(prefillVersion(afterAAgain, "brand")).toBe(1);
  });

  it("empties model A's untouched values when the model is cleared", () => {
    const afterA = pick({ model: modelA, form: { valuation: "", brand: "" } });

    const cleared = pick({
      previous: afterA,
      model: undefined,
      form: { valuation: "450", brand: "Westermo" },
    });

    expect(cleared.values).toEqual({});
    // Bumped so the inputs remount empty.
    expect(prefillVersion(cleared, VALUATION_PREFILL_KEY)).toBe(2);
    expect(prefillVersion(cleared, "brand")).toBe(2);
  });

  it("skips a field that is not on screen when the asset already holds a value for it", () => {
    const next = pick({
      model: modelA,
      form: { valuation: "" },
      savedKeys: ["brand"],
    });

    expect(next.values).toEqual({ [VALUATION_PREFILL_KEY]: "450" });
    expect(prefillVersion(next, "brand")).toBe(0);
  });

  it("pre-fills a field that is not on screen when the asset holds nothing for it", () => {
    const next = pick({ model: modelA, form: { valuation: "" } });

    expect(next.values.brand).toBe("Westermo");
  });

  it("handles a model with a valuation and no custom field defaults", () => {
    const next = pick({
      model: { defaultValuation: 0 },
      form: { valuation: "" },
    });

    // Zero is a real valuation, not an empty one.
    expect(next.values).toEqual({ [VALUATION_PREFILL_KEY]: "0" });
  });

  it("does not pre-fill the valuation when the model has none", () => {
    const next = pick({
      model: { defaultValuation: null, customFieldDefaults: [] },
      form: { valuation: "" },
    });

    expect(next.values).toEqual({});
    expect(prefillVersion(next, VALUATION_PREFILL_KEY)).toBe(0);
  });

  it("bumps versions only for inputs whose value changes", () => {
    const afterA = pick({ model: modelA, form: { valuation: "", brand: "" } });

    // Re-picking the same model changes nothing on screen, so no input
    // remounts.
    const again = pick({
      previous: afterA,
      model: modelA,
      form: { valuation: "450", brand: "Westermo" },
    });

    expect(again.values).toEqual(afterA.values);
    expect(again.versions).toEqual(afterA.versions);
  });
});

describe("getUsablePrefill", () => {
  /** A field definition as the asset form loader sends it. */
  function field(
    overrides: Partial<
      Pick<CustomField, "id" | "name" | "type" | "active" | "options">
    > = {}
  ): Pick<CustomField, "id" | "name" | "type" | "active" | "options"> {
    return {
      id: "brand",
      name: "Brand",
      type: "OPTION",
      active: true,
      options: ["Westermo", "Siemens"],
      ...overrides,
    };
  }

  const prefill: ModelPrefill = {
    values: { brand: "Westermo", toggle: "true", firmware: "v2" },
    versions: {},
  };

  it("returns the pre-filled value when the field can take it", () => {
    expect(getUsablePrefill(prefill, field())).toBe("Westermo");
    expect(
      getUsablePrefill(
        prefill,
        field({ id: "firmware", name: "Firmware", type: "TEXT", options: [] })
      )
    ).toBe("v2");
  });

  it("returns undefined for a dropdown value that is no longer one of its options", () => {
    expect(
      getUsablePrefill(prefill, field({ options: ["Siemens", "Moxa"] }))
    ).toBeUndefined();
  });

  it("returns undefined for a field type models cannot default, such as a checkbox", () => {
    expect(
      getUsablePrefill(
        prefill,
        field({ id: "toggle", name: "Toggle", type: "BOOLEAN", options: [] })
      )
    ).toBeUndefined();
  });

  it("returns undefined for an inactive field or one with nothing pre-filled", () => {
    expect(getUsablePrefill(prefill, field({ active: false }))).toBeUndefined();
    expect(
      getUsablePrefill(prefill, field({ id: "serial", type: "TEXT" }))
    ).toBeUndefined();
  });
});

describe("prefillVersion", () => {
  it("is 0 for a key the pre-fill never touched", () => {
    expect(prefillVersion(EMPTY_MODEL_PREFILL, "brand")).toBe(0);
  });
});
