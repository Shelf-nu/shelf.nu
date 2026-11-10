/**
 * The SSO login page links back to the password login page.
 *
 * Installed as an app (PWA, `display: standalone`) the window has no browser
 * back button, so the page itself must link to email and password login.
 *
 * The native app opens this page in its own sign-in sheet, which has a Cancel
 * button, and the web login page cannot sign the native app in, so the link is
 * not shown there.
 *
 * @see {@link file://./../../../app/routes/_auth+/sso-login.tsx}
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import SSOLogin from "~/routes/_auth+/sso-login";

// why: importing the route pulls the Prisma client transitively; the page's
// loader is replaced by the stub below.
vi.mock("~/database/db.server", () => ({ db: {} }));

/** Renders the SSO page at the given URL inside a router stub. */
function renderAt(url: string) {
  const Stub = createRoutesStub([
    {
      path: "/sso-login",
      Component: SSOLogin,
      loader: () => ({ title: "Log in with SSO", subHeading: "" }),
    },
  ]);
  render(<Stub initialEntries={[url]} />);
}

describe("SSO login page", () => {
  it("links back to the password login page", async () => {
    renderAt("/sso-login");

    const link = await screen.findByRole("link", { name: "Back to login" });
    expect(link).toHaveAttribute("href", "/login");
  });

  it("hides the link in the native app's sign-in sheet", async () => {
    // Only `platform` matters here: the loader is stubbed, so PKCE is not exercised.
    renderAt("/sso-login?platform=mobile");

    await screen.findByRole("button", { name: "Log In" });
    expect(
      screen.queryByRole("link", { name: "Back to login" })
    ).not.toBeInTheDocument();
  });
});
