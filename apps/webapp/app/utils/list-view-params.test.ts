import { describe, it, expect } from "vitest";
import {
  isClientViewOnlyNavigation,
  skipRevalidationOnClientViewChange,
} from "./list-view-params";

const url = (search = "") =>
  new URL(`https://app.test/bookings/b1/overview${search}`);

describe("isClientViewOnlyNavigation", () => {
  it("is true when only client view params (search/sort/page) differ", () => {
    expect(
      isClientViewOnlyNavigation(url("?page=1"), url("?s=cam&page=2"))
    ).toBe(true);
  });

  it("is true when nothing differs (same URL)", () => {
    expect(isClientViewOnlyNavigation(url("?s=a"), url("?s=a"))).toBe(true);
  });

  it("is false when the pathname differs", () => {
    const current = new URL("https://app.test/bookings/b1/overview");
    const next = new URL("https://app.test/bookings/b1/activity");
    expect(isClientViewOnlyNavigation(current, next)).toBe(false);
  });

  it("is false when a non-view param differs (e.g. per_page or orgId)", () => {
    expect(
      isClientViewOnlyNavigation(url("?page=1"), url("?per_page=50"))
    ).toBe(false);
    expect(isClientViewOnlyNavigation(url(""), url("?orgId=x"))).toBe(false);
  });
});

describe("skipRevalidationOnClientViewChange", () => {
  const call = (
    args: Partial<Parameters<typeof skipRevalidationOnClientViewChange>[0]>
  ) =>
    skipRevalidationOnClientViewChange({
      currentUrl: url("?page=1"),
      nextUrl: url("?s=cam"),
      currentParams: {},
      nextParams: {},
      defaultShouldRevalidate: true,
      // why: ShouldRevalidateFunctionArgs has many fields the predicate ignores;
      // we only set the ones it reads.
      ...(args as any),
    } as any);

  it("returns false for a GET client-view-only navigation", () => {
    expect(call({})).toBe(false);
  });

  it("revalidates on a non-GET submission even if the url looks view-only", () => {
    expect(call({ formMethod: "POST" })).toBe(true);
  });

  it("defers to default for a real navigation (different path)", () => {
    expect(
      call({
        currentUrl: new URL("https://app.test/bookings/b1/overview"),
        nextUrl: new URL("https://app.test/assets"),
      })
    ).toBe(true);
  });
});
