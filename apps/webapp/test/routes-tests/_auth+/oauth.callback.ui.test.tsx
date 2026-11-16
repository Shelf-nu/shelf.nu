/**
 * The web SSO callback page: what it posts for each way a sign-in arrives.
 *
 * A sign-in started at `/sso-login` arrives with `?code=`, which the page
 * posts straight away. A sign-in started from the identity provider's
 * dashboard arrives with tokens in the URL fragment: the page asks whose
 * account they sign in, and signs in only after the person confirms. Never
 * posting those tokens unprompted is what stops a forwarded link from silently
 * signing someone into another person's account.
 *
 * @see {@link file://./../../../app/routes/_auth+/oauth.callback.tsx}
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginCallback from "~/routes/_auth+/oauth.callback";

// why: importing the route pulls the Prisma client transitively; the page's
// loader and action are replaced by the stub below.
vi.mock("~/database/db.server", () => ({ db: {} }));

/** The listener the page registers with the Supabase client. */
type AuthListener = (
  event: string,
  session: { access_token: string; refresh_token: string } | null
) => void;

const listeners: AuthListener[] = [];

// why: the Supabase browser client reads the URL fragment itself; the cases
// play the event it emits when it finds tokens there.
vi.mock("~/integrations/supabase/client", () => ({
  supabaseClient: {
    auth: {
      onAuthStateChange: (listener: AuthListener) => {
        listeners.push(listener);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                listeners.splice(listeners.indexOf(listener), 1);
              },
            },
          },
        };
      },
    },
  },
}));

/** Every form the page posts, in order. */
let posted: Record<string, string>[] = [];

/**
 * Renders the callback page at the given URL inside a router stub whose
 * action records each post and answers `identify` with an account to confirm.
 */
function renderAt(url: string) {
  const Stub = createRoutesStub([
    {
      path: "/oauth/callback",
      Component: LoginCallback,
      loader: () => ({ title: "Signing in via SSO", subHeading: "" }),
      action: async ({ request }) => {
        const form = Object.fromEntries(await request.formData()) as Record<
          string,
          string
        >;
        posted.push(form);
        if (form.intent === "identify") {
          return { error: null, confirmAccount: { email: "jane@acme.com" } };
        }
        return { error: null };
      },
    },
  ]);
  render(<Stub initialEntries={[url]} />);
}

/** Plays the Supabase client finding tokens in the URL fragment. */
function emitFragmentSession() {
  for (const listener of [...listeners]) {
    listener("SIGNED_IN", {
      access_token: "fragment-access",
      refresh_token: "fragment-refresh",
    });
  }
}

beforeEach(() => {
  posted = [];
  listeners.length = 0;
});

describe("SSO callback page", () => {
  it("posts the code of a sign-in started at /sso-login", async () => {
    renderAt("/oauth/callback?code=auth-code");

    await waitFor(() =>
      expect(posted).toEqual([
        { intent: "code", code: "auth-code", redirectTo: "/" },
      ])
    );
  });

  it("asks before signing in with tokens from the URL fragment", async () => {
    renderAt("/oauth/callback");
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));

    emitFragmentSession();

    expect(
      await screen.findByText("jane@acme.com", { exact: false })
    ).toBeInTheDocument();
    // Only the access token went to the server, to learn whose account it is.
    expect(posted).toEqual([
      { intent: "identify", accessToken: "fragment-access" },
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(posted[1]).toEqual({
        intent: "confirm",
        accessToken: "fragment-access",
        refreshToken: "fragment-refresh",
        redirectTo: "/",
      })
    );
  });

  it("shows the error Supabase put on the callback URL", async () => {
    renderAt("/oauth/callback?error=access_denied&error_description=Denied");

    expect(await screen.findByText("Denied")).toBeInTheDocument();
    expect(posted).toEqual([]);
  });
});
