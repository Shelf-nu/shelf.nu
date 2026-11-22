import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRerenderAt } from "./use-rerender-at";

/** Renders the current time, so a re-render shows up as new text. */
function Clock({ at }: { at: Date | null }) {
  useRerenderAt(at);
  return <span data-testid="now">{Date.now()}</span>;
}

describe("useRerenderAt", () => {
  const NOW = new Date("2026-10-20T12:00:00Z").getTime();

  beforeEach(() => {
    // why: the hook schedules against the clock, so pin and advance it
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-renders once the given instant passes", () => {
    render(<Clock at={new Date(NOW + 60_000)} />);
    expect(screen.getByTestId("now").textContent).toBe(String(NOW));

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(screen.getByTestId("now").textContent).toBe(String(NOW));

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(Number(screen.getByTestId("now").textContent)).toBeGreaterThan(
      NOW + 60_000
    );
  });

  it("schedules nothing for null or a past instant", () => {
    const { rerender } = render(<Clock at={null} />);
    rerender(<Clock at={new Date(NOW - 1_000)} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps far-off instants instead of firing at once", () => {
    // setTimeout fires immediately above 2^31-1 ms
    render(<Clock at={new Date(NOW + 40 * 24 * 60 * 60 * 1_000)} />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId("now").textContent).toBe(String(NOW));
    // the capped wait re-arms, so a timer is still pending
    act(() => {
      vi.advanceTimersByTime(2 ** 31);
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("clears the pending timer on unmount", () => {
    const { unmount } = render(<Clock at={new Date(NOW + 60_000)} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
