/**
 * The mobile SSO callback page, which the companion app's sign-in sheet lands
 * on: it posts Supabase's code once, and accepts nothing else.
 *
 * @see {@link file://./../../../app/routes/_auth+/oauth.callback_.mobile.tsx}
 */
import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MobileLoginCallback from "~/routes/_auth+/oauth.callback_.mobile";

// why: importing the route pulls the Prisma client transitively; the page's
// loader and action are replaced by the stub below.
vi.mock("~/database/db.server", () => ({ db: {} }));

/** Every form the page posts, in order. */
let posted: Record<string, string>[] = [];

/**
 * Renders the mobile callback page at the given URL inside a router stub
 * whose action records each post and answers without a deeplink, so the page
 * never navigates away.
 */
function renderAt(url: string) {
  const Stub = createRoutesStub([
    {
      path: "/oauth/callback/mobile",
      Component: MobileLoginCallback,
      loader: () => ({ title: "Signing you in", subHeading: "" }),
      action: async ({ request }) => {
        posted.push(
          Object.fromEntries(await request.formData()) as Record<string, string>
        );
        return { error: null };
      },
    },
  ]);
  render(<Stub initialEntries={[url]} />);
}

beforeEach(() => {
  posted = [];
});

describe("mobile SSO callback page", () => {
  it("posts Supabase's code once", async () => {
    renderAt("/oauth/callback/mobile?code=auth-code");

    await waitFor(() => expect(posted).toEqual([{ code: "auth-code" }]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted).toHaveLength(1);
  });

  it("asks to start from the app when the URL carries no code", async () => {
    renderAt("/oauth/callback/mobile");

    expect(
      await screen.findByText("Please start the sign-in from the Shelf app.")
    ).toBeInTheDocument();
    expect(posted).toEqual([]);
  });

  it("reports a failed sign-in in its own words, never the URL's", async () => {
    renderAt(
      "/oauth/callback/mobile?error=access_denied&error_description=Call%20555-0100"
    );

    expect(
      await screen.findByText(
        "Sign-in failed at your identity provider. Please try again."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/555-0100/)).not.toBeInTheDocument();
    expect(posted).toEqual([]);
  });
});
