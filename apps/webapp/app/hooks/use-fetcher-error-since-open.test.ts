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

import { useFetcherErrorSinceOpen } from "./use-fetcher-error-since-open";

type Props = { fetcher: { data?: unknown }; open: boolean };

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
    const { result } = setup({ fetcher: {}, open: true });

    expect(result.current).toBeNull();
  });

  it("reports a refusal that arrived while the dialog was open", () => {
    const { result, rerender } = setup({ fetcher: {}, open: true });

    rerender({ fetcher: { data: REFUSAL }, open: true });

    expect(result.current).toBe("Only 2 units are free.");
  });

  it("reports nothing while the dialog is closed", () => {
    const { result, rerender } = setup({ fetcher: {}, open: true });
    rerender({ fetcher: { data: REFUSAL }, open: true });

    rerender({ fetcher: { data: REFUSAL }, open: false });

    expect(result.current).toBeNull();
  });

  it("ignores a refusal left over from the last opening", () => {
    const { result, rerender } = setup({ fetcher: {}, open: true });
    rerender({ fetcher: { data: REFUSAL }, open: true });
    expect(result.current).toBe("Only 2 units are free.");

    // The dialog closes and opens again. The fetcher is keyed, so it is still
    // handing back that same refusal.
    rerender({ fetcher: { data: REFUSAL }, open: false });
    rerender({ fetcher: { data: REFUSAL }, open: true });

    expect(result.current).toBeNull();
  });

  it("ignores a refusal already in the fetcher when it mounts open", () => {
    // A dialog rendered only while open is mounted fresh on each opening, so
    // its first render is its opening. Anything the fetcher is already
    // holding was answered to some earlier opening, or to a sibling dialog
    // sharing the key.
    const { result } = setup({ fetcher: { data: REFUSAL }, open: true });

    expect(result.current).toBeNull();
  });

  it("reports the next refusal after ignoring a left-over one", () => {
    const { result, rerender } = setup({
      fetcher: { data: REFUSAL },
      open: true,
    });
    expect(result.current).toBeNull();

    rerender({
      fetcher: { data: { error: { message: "Still only 2 units." } } },
      open: true,
    });

    expect(result.current).toBe("Still only 2 units.");
  });

  it("reports nothing for a success", () => {
    const { result, rerender } = setup({ fetcher: {}, open: true });

    // `payload()` stamps `error: null` onto every success, so the key is
    // always present and only its value says anything.
    rerender({ fetcher: { data: { success: true, error: null } }, open: true });

    expect(result.current).toBeNull();
  });

  it("reports nothing for a response carrying no error at all", () => {
    const { result, rerender } = setup({ fetcher: {}, open: true });

    rerender({ fetcher: { data: { assetId: "asset-1" } }, open: true });

    expect(result.current).toBeNull();
  });

  it("reports nothing when the error carries no readable message", () => {
    const { result, rerender } = setup({ fetcher: {}, open: true });

    rerender({ fetcher: { data: { error: { code: 500 } } }, open: true });

    expect(result.current).toBeNull();
  });
});
