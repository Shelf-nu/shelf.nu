import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub, Outlet, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Clarity, isClarityPage } from "./clarity";

/**
 * why: the real module injects the third-party clarity.ms script tag. The
 * behaviour under test is which calls the component makes as the user
 * navigates, so the module is replaced by a recorder that tracks whether the
 * script has been "loaded" the same way `hasStarted()` does.
 */
const clarityCalls = vi.hoisted(() => ({
  started: false,
  calls: [] as string[],
}));
vi.mock("react-microsoft-clarity", () => ({
  clarity: {
    init: () => {
      clarityCalls.started = true;
      clarityCalls.calls.push("init");
    },
    hasStarted: () => clarityCalls.started,
    start: () => clarityCalls.calls.push("start"),
    stop: () => clarityCalls.calls.push("stop"),
  },
}));

/** Mirrors the real mounting: `<Clarity />` sits in the root, above every route. */
function Root() {
  return (
    <>
      <Clarity />
      <Outlet />
    </>
  );
}

/**
 * A page with a button that navigates client-side, the way a redirect after
 * sign-in or a link click does.
 */
function Page() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="go"
      onClick={(e) => navigate(e.currentTarget.value)}
    />
  );
}

/** Renders the app at `path` inside a router that knows every test path. */
function renderAt(path: string) {
  const Stub = createRoutesStub([
    {
      Component: Root,
      children: [
        "/login",
        "/otp",
        "/assets",
        "/accept-invite/:inviteId",
        "/qr/:qrId/contact-owner",
      ].map((routePath) => ({ path: routePath, Component: Page })),
    },
  ]);
  render(<Stub initialEntries={[path]} />);
}

/** Navigates client-side to `path`, as the user would. */
function navigateTo(path: string) {
  const button = screen.getByTestId("go") as HTMLButtonElement;
  button.value = path;
  act(() => {
    fireEvent.click(button);
  });
}

describe("isClarityPage", () => {
  it.each(["/login", "/join", "/otp", "/qr/abc123/contact-owner"])(
    "records the public page %s",
    (pathname) => {
      expect(isClarityPage(pathname)).toBe(true);
    }
  );

  it.each([
    "/assets",
    "/bookings/abc",
    "/settings/general",
    "/onboarding",
    "/accept-invite/inv_1",
    "/oauth/callback",
    "/qr/abc123",
  ])("never records %s", (pathname) => {
    expect(isClarityPage(pathname)).toBe(false);
  });
});

describe("Clarity", () => {
  beforeEach(() => {
    clarityCalls.started = false;
    clarityCalls.calls = [];
    window.env = {
      ...window.env,
      MICROSOFT_CLARITY_ID: "clarity-test-id",
    };
  });

  afterEach(() => {
    window.env = { ...window.env, MICROSOFT_CLARITY_ID: "" };
  });

  it("starts recording on a public page", () => {
    renderAt("/login");

    expect(clarityCalls.calls).toEqual(["init"]);
  });

  it("never loads Clarity when the first page is inside the app", () => {
    renderAt("/assets");

    expect(clarityCalls.calls).toEqual([]);
  });

  it("stops recording when the user moves from a public page into the app", () => {
    renderAt("/login");
    navigateTo("/otp");
    navigateTo("/assets");

    expect(clarityCalls.calls).toEqual(["init", "stop"]);
  });

  it("restarts recording when the user comes back to a public page", () => {
    renderAt("/qr/abc123/contact-owner");
    navigateTo("/assets");
    navigateTo("/login");

    expect(clarityCalls.calls).toEqual(["init", "stop", "start"]);
  });

  it("does not record the invite page, whose URL carries a token", () => {
    renderAt("/login");
    navigateTo("/accept-invite/inv_1?token=secret");

    expect(clarityCalls.calls).toEqual(["init", "stop"]);
  });

  it("does nothing when no Clarity id is configured", () => {
    window.env = { ...window.env, MICROSOFT_CLARITY_ID: "" };

    renderAt("/login");

    expect(clarityCalls.calls).toEqual([]);
  });
});
