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

/**
 * Renders the SSO page at the given URL inside a router stub.
 *
 * @param url - the URL to open
 * @param methods - which SSO methods the stubbed loader reports; SAML SSO
 *   only by default
 */
function renderAt(
  url: string,
  methods: { disableSSO?: boolean; oidcEnabled?: boolean } = {}
) {
  const Stub = createRoutesStub([
    {
      path: "/sso-login",
      Component: SSOLogin,
      loader: () => ({
        title: "Log in with SSO",
        subHeading: "",
        disableSSO: methods.disableSSO ?? false,
        oidc: {
          enabled: methods.oidcEnabled ?? false,
          buttonLabel: "Log in with Acme",
        },
      }),
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

  it("shows no custom OIDC button unless that login is on", async () => {
    renderAt("/sso-login");

    await screen.findByRole("button", { name: "Log In" });
    expect(
      screen.queryByRole("link", { name: "Log in with Acme" })
    ).not.toBeInTheDocument();
  });

  it("offers the custom OIDC login next to the domain form", async () => {
    renderAt("/sso-login", { oidcEnabled: true });

    const link = await screen.findByRole("link", { name: "Log in with Acme" });
    expect(link).toHaveAttribute("href", "/oidc-login");
    expect(screen.getByRole("button", { name: "Log In" })).toBeInTheDocument();
  });

  it("keeps the native-app flow on the custom OIDC button and hides the domain form without SAML SSO", async () => {
    renderAt("/sso-login?platform=mobile", {
      oidcEnabled: true,
      disableSSO: true,
    });

    const link = await screen.findByRole("link", { name: "Log in with Acme" });
    expect(link).toHaveAttribute("href", "/oidc-login?platform=mobile");
    expect(
      screen.queryByRole("button", { name: "Log In" })
    ).not.toBeInTheDocument();
  });
});
