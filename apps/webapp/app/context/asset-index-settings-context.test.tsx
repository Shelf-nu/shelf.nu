/**
 * AssetIndexSettingsProvider — unit tests
 *
 * Pins the override contract for the asset-index settings context: with no
 * provider mounted, a settings hook must fall through to the stored loader
 * value untouched; with a provider mounted, an overridden key wins.
 *
 * @see {@link file://./asset-index-settings-context.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { AssetIndexSettingsProvider } from "./asset-index-settings-context";

// why: the hook reads the asset index loader and the fetcher list, neither of
// which exist without a router context in a unit test. `...actual` keeps every
// other react-router export (e.g. types used elsewhere in the module graph)
// real, matching the house mocking idiom.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: () => ({ settings: { freezeColumn: true } }),
    useFetchers: () => [],
  };
});

/** Renders the freeze-column hook's current value as text for assertions. */
function Probe() {
  return <span>{String(useAssetIndexFreezeColumn())}</span>;
}

describe("AssetIndexSettingsProvider", () => {
  it("falls through to the stored setting when no provider is mounted", () => {
    render(<Probe />);

    expect(screen.getByText("true")).toBeTruthy();
  });

  it("lets a subtree switch the frozen column off", () => {
    render(
      <AssetIndexSettingsProvider freezeColumn={false}>
        <Probe />
      </AssetIndexSettingsProvider>
    );

    expect(screen.getByText("false")).toBeTruthy();
  });
});
