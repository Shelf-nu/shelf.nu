/**
 * The PDF templates card on Settings > General, on a plan with PDF templates
 * and on one without.
 *
 * @see {@link file://./pdf-templates-settings.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import {
  BOOKING_CHECKLIST_CONFIG,
  CHECKOUT_RECEIPT_CONFIG,
} from "~/modules/pdf-template/config";

import { PdfTemplatesSettings } from "./pdf-templates-settings";

const TEMPLATES = [
  {
    id: "doc-checklist",
    name: "Checklist",
    isDefault: true,
    config: BOOKING_CHECKLIST_CONFIG,
  },
  {
    id: "doc-receipt",
    name: "Check-out receipt",
    isDefault: false,
    config: CHECKOUT_RECEIPT_CONFIG,
  },
];

function renderCard(props: Parameters<typeof PdfTemplatesSettings>[0]) {
  const Stub = createRoutesStub([
    {
      path: "/settings/general",
      Component: () => <PdfTemplatesSettings {...props} />,
    },
  ]);
  render(<Stub initialEntries={["/settings/general"]} />);
}

describe("PDF templates card", () => {
  it("lists the templates with their actions on a plan that has them", async () => {
    renderCard({ canCustomize: true, templates: TEMPLATES, customFields: [] });

    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("ChecklistDefault template"),
      expect.stringContaining("Check-out receipt"),
    ]);
    expect(
      within(rows[1]).getByRole("button", { name: "Make default" })
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add template" })).toBeVisible();
  });

  it("shows an upgrade note and no templates on a plan without them", async () => {
    renderCard({ canCustomize: false, templates: [], customFields: [] });

    expect(await screen.findByText("PDF templates")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Upgrade your plan" })
    ).toHaveAttribute("href", "/account-details/subscription");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add template" })
    ).not.toBeInTheDocument();
  });
});
