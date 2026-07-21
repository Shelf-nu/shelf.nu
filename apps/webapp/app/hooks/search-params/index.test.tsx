/**
 * Unit tests for {@link useSearchParams} in `./index.ts`.
 *
 * Focused on the render-stability fix: the cookie-aware `customSetSearchParams`
 * setter must keep a stable reference across re-renders when its inputs are
 * unchanged, so consumers that place the returned setter in a `useEffect` /
 * `useCallback` dependency array (e.g. the asset-reminder dialog) don't re-fire
 * on every render. See `.claude/rules/react-render-stability.md`.
 *
 * @see {@link file://./index.ts}
 */

import { renderHook } from "@testing-library/react";
import Cookies from "js-cookie";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: renderHook re-invokes the hook body on every render, so instead of a
// static object we return live values from these hoisted refs, letting each
// test control what react-router "sees" without re-mocking the module.
const routerMocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams("status=AVAILABLE"),
  setSearchParams: vi.fn(),
  pathname: "/assets",
  loaderData: { filters: "", settings: { mode: "SIMPLE" } } as Record<
    string,
    unknown
  >,
  routeLoaderData: {
    currentOrganization: { id: "org-1" },
  } as Record<string, unknown> | undefined,
}));

// why: useSearchParams (module under test) composes several react-router hooks
// (directly, and transitively via useCurrentOrganization / useAssetIndexViewState
// in sibling files) — mocking react-router at this boundary controls every one
// of them without needing to mock the module under test itself (which would
// also replace the real `useSearchParams` export we're testing).
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useSearchParams: () =>
      [routerMocks.searchParams, routerMocks.setSearchParams] as const,
    useLocation: () => ({
      pathname: routerMocks.pathname,
      search: "",
      hash: "",
      state: null,
      key: "test",
    }),
    useLoaderData: () => routerMocks.loaderData,
    useRouteLoaderData: () => routerMocks.routeLoaderData,
  };
});

import { useSearchParams } from "./index";

describe("useSearchParams", () => {
  beforeEach(() => {
    // why: each test mutates the shared hoisted mock state (pathname / loader
    // data) — reset to known defaults so tests don't leak into one another.
    routerMocks.searchParams = new URLSearchParams("status=AVAILABLE");
    routerMocks.setSearchParams = vi.fn();
    routerMocks.pathname = "/assets";
    routerMocks.loaderData = { filters: "", settings: { mode: "SIMPLE" } };
    routerMocks.routeLoaderData = { currentOrganization: { id: "org-1" } };
  });

  it("keeps a stable customSetSearchParams identity across re-renders on a cookie-filtered page", () => {
    // Cookie-filtered page ("/assets") with a resolved organization takes the
    // memoized customSetSearchParams branch.
    const { result, rerender } = renderHook(() => useSearchParams());
    const firstSetter = result.current[1];

    rerender();
    rerender();

    expect(result.current[1]).toBe(firstSetter);
  });

  it("returns the raw react-router setter unchanged on a page without cookie filters", () => {
    // "/settings" is not in ALLOWED_FILTER_PATHNAMES, so the hook must take the
    // early-return-equivalent branch and hand back the raw setSearchParams as-is.
    routerMocks.pathname = "/settings";
    routerMocks.routeLoaderData = { currentOrganization: { id: "org-1" } };

    const { result, rerender } = renderHook(() => useSearchParams());

    expect(result.current[1]).toBe(routerMocks.setSearchParams);

    rerender();

    expect(result.current[1]).toBe(routerMocks.setSearchParams);
  });

  it("returns the raw react-router setter unchanged when there is no current organization", () => {
    // No organization resolved (e.g. still loading) also takes the raw-setter
    // branch, even on an otherwise cookie-filtered pathname.
    routerMocks.pathname = "/assets";
    routerMocks.routeLoaderData = undefined;

    const { result, rerender } = renderHook(() => useSearchParams());

    expect(result.current[1]).toBe(routerMocks.setSearchParams);

    rerender();

    expect(result.current[1]).toBe(routerMocks.setSearchParams);
  });

  it("still forwards to the raw setter and destroys the matching cookie key when a param is removed", () => {
    // why: `useCookieDestroy`'s returned function was refactored (ref-latch,
    // see index.ts) purely for identity stability — this test guards that its
    // *observable* behavior (forwarding + cookie mutation) is unchanged.
    routerMocks.loaderData = {
      filters: "status=AVAILABLE",
      settings: { mode: "SIMPLE" },
    };
    Cookies.set("org-1_assetFilter_v2", "status=AVAILABLE", { path: "/" });

    const { result } = renderHook(() => useSearchParams());
    const [, customSetSearchParams] = result.current;

    // Non-functional-updater form: "status" is dropped from the next params,
    // which should be detected as a removed key and stripped from the cookie.
    customSetSearchParams(new URLSearchParams(""));

    expect(routerMocks.setSearchParams).toHaveBeenCalledTimes(1);
    expect(routerMocks.setSearchParams.mock.calls[0][0]).toBeInstanceOf(
      URLSearchParams
    );
    // The cookie had only "status", so removing it deletes the cookie entirely.
    expect(Cookies.get("org-1_assetFilter_v2")).toBeUndefined();
  });
});
