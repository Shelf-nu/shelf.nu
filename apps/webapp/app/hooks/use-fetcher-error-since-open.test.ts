/**
 * Tests for {@link useFetcherErrorSinceOpen}.
 *
 * The question the hook answers is "did the server say this to the operator
 * who is looking at the dialog right now", so the cases below cover both ways
 * a dialog can arrive at an opening: one that stays mounted and toggles its
 * `open` prop, and one that is mounted fresh each time it opens.
 *
 * @see {@link file://./use-fetcher-error-since-open.ts}
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  useFetcherErrorSinceOpen,
  useFetcherOutcomeSinceOpen,
} from "./use-fetcher-error-since-open";

type Fetcher = {
  data?: unknown;
  state: "idle" | "submitting" | "loading";
};

type Props = { fetcher: Fetcher; open: boolean };

/** Renders the hook so each test can advance the fetcher and the open state. */
function setup(initialProps: Props) {
  return renderHook(
    (props: Props) => useFetcherErrorSinceOpen(props.fetcher, props.open),
    { initialProps }
  );
}

const REFUSAL = { error: { message: "Only 2 units are free." } };

describe("useFetcherErrorSinceOpen", () => {
  it("reports nothing before the fetcher has a response", () => {
    const { result } = setup({ fetcher: { state: "idle" }, open: true });

    expect(result.current).toBeNull();
  });

  it("reports a refusal that arrived while the dialog was open", () => {
    const { result, rerender } = setup({
      fetcher: { state: "idle" },
      open: true,
    });

    rerender({ fetcher: { state: "idle", data: REFUSAL }, open: true });

    expect(result.current).toBe("Only 2 units are free.");
  });

  it("reports nothing while the dialog is closed", () => {
    const { result, rerender } = setup({
      fetcher: { state: "idle" },
      open: true,
    });
    rerender({ fetcher: { state: "idle", data: REFUSAL }, open: true });

    rerender({ fetcher: { state: "idle", data: REFUSAL }, open: false });

    expect(result.current).toBeNull();
  });

  it("ignores a refusal left over from the last opening", () => {
    const { result, rerender } = setup({
      fetcher: { state: "idle" },
      open: true,
    });
    rerender({ fetcher: { state: "idle", data: REFUSAL }, open: true });
    expect(result.current).toBe("Only 2 units are free.");

    // The dialog closes and opens again. The fetcher is keyed, so it is still
    // handing back that same refusal.
    rerender({ fetcher: { state: "idle", data: REFUSAL }, open: false });
    rerender({ fetcher: { state: "idle", data: REFUSAL }, open: true });

    expect(result.current).toBeNull();
  });

  it("ignores a refusal already in the fetcher when it mounts open", () => {
    // A dialog rendered only while open is mounted fresh on each opening, so
    // its first render is its opening. Anything the fetcher is already
    // holding was answered to some earlier opening, or to a sibling dialog
    // sharing the key.
    const { result } = setup({
      fetcher: { state: "idle", data: REFUSAL },
      open: true,
    });

    expect(result.current).toBeNull();
  });

  it("reports the next refusal after ignoring a left-over one", () => {
    const { result, rerender } = setup({
      fetcher: { state: "idle", data: REFUSAL },
      open: true,
    });
    expect(result.current).toBeNull();

    rerender({
      fetcher: {
        state: "idle",
        data: { error: { message: "Still only 2 units." } },
      },
      open: true,
    });

    expect(result.current).toBe("Still only 2 units.");
  });

  it("reports nothing for a success", () => {
    const { result, rerender } = setup({
      fetcher: { state: "idle" },
      open: true,
    });

    // `payload()` stamps `error: null` onto every success, so the key is
    // always present and only its value says anything.
    rerender({
      fetcher: { state: "idle", data: { success: true, error: null } },
      open: true,
    });

    expect(result.current).toBeNull();
  });

  it("reports nothing for a response carrying no error at all", () => {
    const { result, rerender } = setup({
      fetcher: { state: "idle" },
      open: true,
    });

    rerender({
      fetcher: { state: "idle", data: { assetId: "asset-1" } },
      open: true,
    });

    expect(result.current).toBeNull();
  });

  it("reports nothing when the error carries no readable message", () => {
    const { result, rerender } = setup({
      fetcher: { state: "idle" },
      open: true,
    });

    rerender({
      fetcher: { state: "idle", data: { error: { code: 500 } } },
      open: true,
    });

    expect(result.current).toBeNull();
  });

  describe("useFetcherOutcomeSinceOpen", () => {
    /** Renders the outcome hook so each test can advance its inputs. */
    function setupOutcome(initialProps: Props) {
      return renderHook(
        (props: Props) => useFetcherOutcomeSinceOpen(props.fetcher, props.open),
        { initialProps }
      );
    }

    const SUCCESS = { success: true, error: null };

    it("holds a success back until the invalidated loaders have run", () => {
      // A fetcher carries its action's result while it is still `loading`, so
      // the response is readable before the page behind the dialog shows it.
      const { result, rerender } = setupOutcome({
        fetcher: { state: "idle" },
        open: true,
      });

      rerender({ fetcher: { state: "submitting" }, open: true });
      rerender({ fetcher: { state: "loading", data: SUCCESS }, open: true });

      expect(result.current.status).toBe("pending");
    });

    it("accepts the success once the fetcher goes idle", () => {
      const { result, rerender } = setupOutcome({
        fetcher: { state: "idle" },
        open: true,
      });

      rerender({ fetcher: { state: "submitting" }, open: true });
      rerender({ fetcher: { state: "loading", data: SUCCESS }, open: true });
      rerender({ fetcher: { state: "idle", data: SUCCESS }, open: true });

      expect(result.current.status).toBe("accepted");
    });

    it("reports a refusal straight away, with nothing to wait for", () => {
      // Nothing behind the dialog changed, so a refusal does not wait for idle.
      const { result, rerender } = setupOutcome({
        fetcher: { state: "idle" },
        open: true,
      });

      rerender({ fetcher: { state: "submitting" }, open: true });
      rerender({ fetcher: { state: "loading", data: REFUSAL }, open: true });

      expect(result.current.status).toBe("rejected");
      expect(result.current.message).toBe("Only 2 units are free.");
    });

    it("stays pending when the keyed fetcher is replaced and has not answered", () => {
      // Navigating to another entity swaps in that entity's fetcher, which
      // carries no data while the snapshot still describes the previous one.
      const { result, rerender } = setupOutcome({
        fetcher: { state: "idle" },
        open: true,
      });
      rerender({ fetcher: { state: "idle", data: REFUSAL }, open: true });
      expect(result.current.status).toBe("rejected");

      rerender({ fetcher: { state: "idle" }, open: true });

      expect(result.current.status).toBe("pending");
    });
  });
});
