/**
 * The asset form's Asset Model row hands the form the picked model's row, so a
 * model found by search pre-fills like one from the loader's page. These tests
 * pin that it asks the search for defaults and converts the picked item.
 *
 * @see {@link file://./asset-model-form-row.tsx}
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelFilterItem } from "~/hooks/use-model-filters";
import { AssetModelFormRow } from "./asset-model-form-row";

/** What the row passed to `DynamicSelect`. */
const dynamicSelectProps: {
  model?: Record<string, unknown>;
  onChange?: (id: string | undefined, item?: ModelFilterItem) => void;
} = {};

// why: the select's own picking is tested in dynamic-select.test.tsx; here
// only what the row asks of it and does with its answer matter.
vi.mock("../dynamic-select/dynamic-select", () => ({
  default: (props: typeof dynamicSelectProps) => {
    dynamicSelectProps.model = props.model;
    dynamicSelectProps.onChange = props.onChange;
    return null;
  },
}));

// why: the "Create" shortcut reads the member's permissions from the router.
vi.mock("~/hooks/use-inline-create-permissions", () => ({
  useInlineCreatePermissions: () => ({ assetModel: false }),
}));

describe("AssetModelFormRow", () => {
  it("asks the search for model defaults", () => {
    render(
      <AssetModelFormRow disabled={false} required={false} onChange={vi.fn()} />
    );

    expect(dynamicSelectProps.model).toMatchObject({
      name: "assetModel",
      withDefaults: "true",
    });
  });

  it("hands the form the picked model's row with its defaults", () => {
    const onChange = vi.fn();
    render(
      <AssetModelFormRow
        disabled={false}
        required={false}
        onChange={onChange}
      />
    );

    dynamicSelectProps.onChange?.("m-old", {
      id: "m-old",
      name: "ZZ Test Model",
      metadata: {},
      defaultCategoryId: "cat-1",
      defaultValuation: 199,
    } as ModelFilterItem);

    expect(onChange).toHaveBeenCalledWith(
      "m-old",
      expect.objectContaining({
        id: "m-old",
        defaultCategoryId: "cat-1",
        defaultValuation: 199,
      })
    );
  });

  it("passes no row when the pick is cleared", () => {
    const onChange = vi.fn();
    render(
      <AssetModelFormRow
        disabled={false}
        required={false}
        onChange={onChange}
      />
    );

    dynamicSelectProps.onChange?.(undefined, undefined);

    expect(onChange).toHaveBeenCalledWith(undefined, undefined);
  });
});
