/**
 * The PDF documents card on Settings > General, on a plan with PDF documents
 * and on one without.
 *
 * @see {@link file://./pdf-documents-settings.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import {
  BOOKING_CHECKLIST_CONFIG,
  CHECKOUT_RECEIPT_CONFIG,
} from "~/modules/pdf-document/config";

import { PdfDocumentsSettings } from "./pdf-documents-settings";

const DOCUMENTS = [
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

function renderCard(props: Parameters<typeof PdfDocumentsSettings>[0]) {
  const Stub = createRoutesStub([
    {
      path: "/settings/general",
      Component: () => <PdfDocumentsSettings {...props} />,
    },
  ]);
  render(<Stub initialEntries={["/settings/general"]} />);
}

describe("PDF documents card", () => {
  it("lists the documents with their actions on a plan that has them", async () => {
    renderCard({ canCustomize: true, documents: DOCUMENTS, customFields: [] });

    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("ChecklistDefault document"),
      expect.stringContaining("Check-out receipt"),
    ]);
    expect(
      within(rows[1]).getByRole("button", { name: "Make default" })
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add document" })).toBeVisible();
  });

  it("shows an upgrade note and no documents on a plan without them", async () => {
    renderCard({ canCustomize: false, documents: [], customFields: [] });

    expect(await screen.findByText("PDF documents")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Upgrade your plan" })
    ).toHaveAttribute("href", "/account-details/subscription");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add document" })
    ).not.toBeInTheDocument();
  });
});
