/**
 * Last audit date cell tests
 *
 * Behavior tests for the cell states (locked, never audited) and the hover
 * card contents once the audit history has loaded.
 *
 * @see {@link file://./last-audit-date-cell.tsx}
 */
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query: { data: unknown; error: string | undefined } = {
  data: undefined,
  error: undefined,
};

// why: react-router's Link needs the router context, which is not mounted in
// happy-dom; it becomes a plain anchor.
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      ...rest
    }: { to: string; children: ReactNode } & Record<string, unknown>) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

// why: useApiQuery calls fetch against the API; the test feeds it the
// response state directly.
// The spy records the options so tests can assert when the request is enabled.
const apiQueryMock = vi.fn((_options: { api: string; enabled?: boolean }) => ({
  ...query,
  isLoading: false,
}));
vi.mock("~/hooks/use-api-query", () => ({
  default: (options: { api: string; enabled?: boolean }) =>
    apiQueryMock(options),
}));

// why: DateS reads request info from the root loader; render the raw value.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: string }) => <time>{date}</time>,
}));

import { LastAuditDateCell } from "./last-audit-date-cell";

function renderCell(props: Parameters<typeof LastAuditDateCell>[0]) {
  return render(
    <table>
      <tbody>
        <tr>
          <LastAuditDateCell {...props} />
        </tr>
      </tbody>
    </table>
  );
}

/** Opens the card by keyboard focus, which Radix opens without a delay. */
async function openCard() {
  await userEvent.tab();
}

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Audit ${id}`,
  status: "COMPLETED",
  completedAt: "2026-01-02T00:00:00.000Z",
  dueDate: null,
  assetStatus: "FOUND",
  ...over,
});

describe("LastAuditDateCell", () => {
  beforeEach(() => {
    query.data = undefined;
    query.error = undefined;
    apiQueryMock.mockClear();
  });

  it("renders an unlock link when locked", () => {
    renderCell({ assetId: "a1", lastAuditDate: null, access: "locked" });
    expect(screen.getByRole("link", { name: "Unlock audits" })).toHaveAttribute(
      "href",
      "/audits"
    );
  });

  it("never enables the history request when locked", async () => {
    renderCell({ assetId: "a1", lastAuditDate: null, access: "locked" });
    await userEvent.tab();
    expect(apiQueryMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });

  it("waits for the card to open before enabling the history request", async () => {
    renderCell({ assetId: "a1", lastAuditDate: null, access: "available" });
    expect(apiQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        api: "/api/assets/a1/audit-history",
        enabled: false,
      })
    );
    await openCard();
    await waitFor(() =>
      expect(apiQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true })
      )
    );
  });

  it("renders Never audited without a date", () => {
    renderCell({ assetId: "a1", lastAuditDate: null, access: "available" });
    expect(screen.getByText("Never audited")).toBeInTheDocument();
  });

  it("lists recent and upcoming audits with a view all link", async () => {
    query.data = {
      recent: [item("r1"), item("r2")],
      upcoming: [
        item("u1", {
          status: "PENDING",
          completedAt: null,
          dueDate: "2026-03-01T00:00:00.000Z",
          assetStatus: "PENDING",
        }),
      ],
    };
    renderCell({
      assetId: "a1",
      lastAuditDate: "2026-01-02T00:00:00.000Z",
      access: "available",
    });
    await openCard();

    expect(await screen.findByText("Recent")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    for (const id of ["r1", "r2", "u1"]) {
      expect(
        screen.getByRole("link", { name: new RegExp(`Audit ${id}`) })
      ).toHaveAttribute("href", `/audits/${id}`);
    }
    expect(
      screen.getByRole("link", { name: "View all audits" })
    ).toHaveAttribute("href", "/audits?assetId=a1");
  });

  it("shows no view all link when there is no history", async () => {
    query.data = { recent: [], upcoming: [] };
    renderCell({ assetId: "a1", lastAuditDate: null, access: "available" });
    await openCard();

    expect(await screen.findByText(/No audits/)).toBeInTheDocument();
    expect(screen.queryByText("View all audits")).not.toBeInTheDocument();
  });

  it("shows an error line when the request fails", async () => {
    query.error = "boom";
    renderCell({ assetId: "a1", lastAuditDate: null, access: "available" });
    await openCard();
    expect(
      await screen.findByText("Could not load audits.")
    ).toBeInTheDocument();
  });

  it("labels upcoming rows by audit status", async () => {
    query.data = {
      recent: [],
      upcoming: [
        item("p1", {
          status: "PENDING",
          completedAt: null,
          dueDate: null,
          assetStatus: "PENDING",
        }),
        item("x1", {
          status: "ACTIVE",
          completedAt: null,
          dueDate: null,
          assetStatus: "FOUND",
        }),
      ],
    };
    renderCell({ assetId: "a1", lastAuditDate: null, access: "available" });
    await openCard();

    const active = await screen.findByRole("link", { name: /Audit x1/ });
    expect(active).toHaveTextContent("In progress");
    expect(active).toHaveTextContent("Found");
    const pending = screen.getByRole("link", { name: /Audit p1/ });
    expect(pending).not.toHaveTextContent("In progress");
    expect(pending).not.toHaveTextContent("Due");
  });
});
