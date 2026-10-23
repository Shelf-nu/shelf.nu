/**
 * Notifications tab UI: every switch is labelled and described, flipping one
 * (by pointer or keyboard) submits only that switch without moving the global
 * progress bar, a rejected save shows the server message and flips the switch
 * back, and a person with no plan that includes push is told so.
 *
 * @see {@link file://../../../app/routes/_layout+/account-details.notifications.tsx}
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, data, useFetchers } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { isFetcherExcludedFromProgress } from "~/hooks/use-nprogress";

// why: importing the route reaches the Prisma client through its loader and
// action imports; only the component is under test, against a stubbed route
vi.mock("~/database/db.server", () => ({ db: {} }));

const { default: NotificationSettings } = await import(
  "~/routes/_layout+/account-details.notifications"
);

const SAVED = {
  pushEnabled: true,
  bookings: true,
  audits: false,
  stockAndReminders: true,
};

/** Keys of every fetcher seen in flight while the tab was mounted. */
const fetcherKeysInFlight = new Set<string>();

/** The tab, beside a probe that records which fetchers go in flight. */
function TabWithFetcherProbe() {
  for (const fetcher of useFetchers()) {
    if (fetcher.state !== "idle") fetcherKeysInFlight.add(fetcher.key);
  }
  return <NotificationSettings />;
}

/**
 * Renders the tab on a stubbed route whose action hands each submission to
 * `answer` and returns what it returns.
 */
function renderTab(
  answer: (submitted: Record<string, FormDataEntryValue>) => unknown,
  { pushAvailable = true }: { pushAvailable?: boolean } = {}
) {
  fetcherKeysInFlight.clear();
  const Stub = createRoutesStub([
    {
      path: "/account-details/notifications",
      Component: TabWithFetcherProbe,
      loader: () => ({
        error: null,
        title: "Notifications",
        preferences: SAVED,
        pushAvailable,
      }),
      action: async ({ request }) =>
        answer(Object.fromEntries(await request.formData())),
    },
  ]);
  return render(<Stub initialEntries={["/account-details/notifications"]} />);
}

/** A save the server accepts. */
const accept = () => ({ error: null, preferences: SAVED });

describe("notifications tab", () => {
  it("shows a labelled, described switch for each setting", async () => {
    renderTab(accept);

    const bookings = await screen.findByRole("switch", { name: "Bookings" });
    expect(bookings).toHaveAttribute("aria-checked", "true");
    expect(bookings).toHaveAccessibleDescription(/custodian/);
    expect(screen.getByRole("switch", { name: "Audits" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(
      screen.getByRole("switch", { name: "Push notifications" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Stock and reminders" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Push arrives on phones where you are signed in to the Shelf app."
      )
    ).toBeInTheDocument();
  });

  it("submits only the switch that was flipped", async () => {
    const submissions: Record<string, FormDataEntryValue>[] = [];
    renderTab((submitted) => {
      submissions.push(submitted);
      return accept();
    });

    await userEvent.click(
      await screen.findByRole("switch", { name: "Bookings" })
    );

    await waitFor(() =>
      expect(submissions).toEqual([{ preference: "bookings", enabled: "off" }])
    );
  });

  it("saves a switch on a fetcher the global progress bar ignores", async () => {
    const submissions: Record<string, FormDataEntryValue>[] = [];
    renderTab((submitted) => {
      submissions.push(submitted);
      return accept();
    });

    await userEvent.click(
      await screen.findByRole("switch", { name: "Bookings" })
    );
    await waitFor(() => expect(submissions).toHaveLength(1));

    expect([...fetcherKeysInFlight]).toEqual([
      "notification-preference-bookings",
    ]);
    expect(
      isFetcherExcludedFromProgress("notification-preference-bookings")
    ).toBe(true);
  });

  it("says when none of the person's workspaces has a plan with push", async () => {
    renderTab(accept, { pushAvailable: false });

    expect(
      await screen.findByText(
        "Push notifications are not included in your workspaces' plans."
      )
    ).toBeInTheDocument();
  });

  it("toggles the focused switch with the space key", async () => {
    const submissions: Record<string, FormDataEntryValue>[] = [];
    renderTab((submitted) => {
      submissions.push(submitted);
      return accept();
    });
    await screen.findByRole("switch", { name: "Push notifications" });

    await userEvent.tab();
    expect(
      screen.getByRole("switch", { name: "Push notifications" })
    ).toHaveFocus();
    await userEvent.keyboard(" ");

    await waitFor(() =>
      expect(submissions).toEqual([
        { preference: "pushEnabled", enabled: "off" },
      ])
    );
  });

  it("shows the server message and flips the switch back when the save fails", async () => {
    renderTab(() =>
      data(
        { error: { message: "Your settings could not be saved." } },
        { status: 500 }
      )
    );
    const bookings = await screen.findByRole("switch", { name: "Bookings" });

    await userEvent.click(bookings);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your settings could not be saved."
    );
    expect(bookings).toHaveAttribute("aria-checked", "true");
  });
});
