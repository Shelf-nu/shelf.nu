/**
 * Asset Last Audit Card UI Tests
 *
 * The sidebar card heads with the asset's last audit (or "never been
 * audited"), lists the audits before it as "Earlier" and the ones ahead as
 * "Upcoming", and links to every audit of the asset. Without history (a caller who may not see audit dates) it renders
 * nothing.
 *
 * @see {@link file://./asset-last-audit-card.tsx}
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AuditHistoryListItem } from "~/components/audit/asset-audit-history-list";

// why: react-router's Link reads route context, which a unit test does not
// mount; a plain anchor keeps `to` assertable.
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

// why: DateS reads the user's date preferences from root loader data; a fixed
// rendering keeps the assertions independent of locale.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: string | Date }) => (
    <span>{new Date(date).toISOString().slice(0, 10)}</span>
  ),
}));

import { AssetLastAuditCard } from "./asset-last-audit-card";

/** Builds an audit history item, overriding any field. */
function item(overrides: Partial<AuditHistoryListItem>): AuditHistoryListItem {
  return {
    id: "audit-1",
    name: "Spring audit",
    status: "COMPLETED",
    completedAt: null,
    dueDate: null,
    assetStatus: "FOUND",
    ...overrides,
  };
}

describe("AssetLastAuditCard", () => {
  it("renders nothing without history", () => {
    const { container } = render(
      <AssetLastAuditCard assetId="asset-1" history={null} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("heads with the last audit and lists the ones before it as earlier", () => {
    render(
      <AssetLastAuditCard
        assetId="asset-1"
        history={{
          recent: [
            item({
              id: "audit-new",
              name: "Q3 audit",
              completedAt: new Date("2026-07-31T08:00:00Z"),
              assetStatus: "MISSING",
            }),
            item({
              id: "audit-old",
              name: "Q2 audit",
              completedAt: new Date("2026-04-30T08:00:00Z"),
            }),
          ],
          upcoming: [
            item({
              id: "audit-next",
              name: "Q4 audit",
              status: "PENDING",
              dueDate: new Date("2026-11-15T08:00:00Z"),
              assetStatus: "PENDING",
            }),
          ],
        }}
      />
    );

    // The headline row is the newest audit, with its date and result.
    const headline = screen
      .getByRole("link", { name: "Q3 audit" })
      .closest("li");
    expect(headline).toHaveTextContent("Completed 2026-07-31");
    expect(headline).toHaveTextContent("Missing");
    expect(screen.getByRole("link", { name: "Q3 audit" })).toHaveAttribute(
      "href",
      "/audits/audit-new"
    );
    // Older audits sit under "Earlier"; the headline is not repeated there.
    expect(screen.getByText("Earlier")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Q3 audit" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Q2 audit" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Q4 audit" })).toHaveAttribute(
      "href",
      "/audits/audit-next"
    );
    expect(screen.getByText("Upcoming")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View all audits" })
    ).toHaveAttribute("href", "/audits?assetId=asset-1");
  });

  it("keeps the full list link when the last audit is the only one", () => {
    render(
      <AssetLastAuditCard
        assetId="asset-1"
        history={{
          recent: [item({ completedAt: new Date("2026-07-31T08:00:00Z") })],
          upcoming: [],
        }}
      />
    );

    expect(screen.queryByText("Earlier")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all audits" })).toBeVisible();
  });

  it("says never audited and still lists an upcoming audit", () => {
    render(
      <AssetLastAuditCard
        assetId="asset-1"
        history={{
          recent: [],
          upcoming: [
            item({
              name: "First audit",
              status: "PENDING",
              assetStatus: "PENDING",
            }),
          ],
        }}
      />
    );

    expect(screen.getByText("This asset has never been audited")).toBeVisible();
    expect(screen.getByRole("link", { name: /First audit/ })).toBeVisible();
    expect(screen.queryByText("Earlier")).not.toBeInTheDocument();
  });

  it("omits the audit list and link when the asset has no audits", () => {
    render(
      <AssetLastAuditCard
        assetId="asset-1"
        history={{ recent: [], upcoming: [] }}
      />
    );

    expect(screen.getByText("This asset has never been audited")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "View all audits" })
    ).not.toBeInTheDocument();
  });
});
