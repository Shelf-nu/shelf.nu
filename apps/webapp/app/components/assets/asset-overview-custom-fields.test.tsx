/**
 * The asset overview's custom fields card, fed by the same row builder the
 * route uses (`buildAssetOverviewCustomFields`).
 *
 * Link fields are rows of the one card, in name order with every other
 * field: a set one shows its link as a chip, and an empty one reads "Not set"
 * for an editor and stays hidden from a member who cannot edit, like a plain
 * field. Only editors can name a link from its chip.
 *
 * @see {@link file://./asset-overview-custom-fields.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { LINK_TITLES, MANUAL_URL } from "@helpers/link-titles";
import {
  buildAssetOverviewCustomFields,
  type CustomFieldDefinitionForDisplay,
} from "~/utils/custom-fields";
import { CustomFieldsCard } from "./asset-overview-custom-fields";

// why: the hook reads the root loader's request info, which a stubbed router
// does not have; no row here is a DATE, so the prefs are never read.
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({ prefs: {} }),
}));

function definition(
  id: string,
  name: string,
  format: "PLAIN" | "LINK"
): CustomFieldDefinitionForDisplay {
  return { id, name, type: "TEXT", format, options: [] };
}

const manual = definition("cf-manual", "Manual", "LINK");
const certificate = definition("cf-cert", "Calibration certificate", "LINK");
const serial = definition("cf-serial", "Serial number", "PLAIN");
const notes = definition("cf-notes", "Notes", "PLAIN");

/**
 * Renders the card the way the overview does, inside a router, with the
 * loader's `linkTitles` fixture. Manual (Link) and Serial number (plain) are
 * set; Calibration certificate (Link) and Notes (plain) are empty.
 */
function renderCard({
  canEditAsset,
  manualUrl = "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12",
}: {
  canEditAsset: boolean;
  manualUrl?: string;
}) {
  const rows = buildAssetOverviewCustomFields({
    storedValues: [
      {
        value: { raw: "ABC-123", valueText: "ABC-123" },
        customField: serial,
      },
      {
        value: { raw: manualUrl, valueText: manualUrl },
        customField: manual,
      },
    ],
    editableDefinitions: canEditAsset
      ? [serial, notes, manual, certificate]
      : [],
  });
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <CustomFieldsCard
          rows={rows}
          titles={LINK_TITLES}
          canEditAsset={canEditAsset}
          locale="en-US"
          currency="USD"
        />
      ),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

/** The card's rows, each read as its label and its displayed value. */
async function cardRows() {
  const label = await screen.findByText("Serial number");
  const card = label.closest<HTMLElement>(".card")!;
  return within(card)
    .getAllByRole("listitem")
    .map((row) => ({
      label: row.firstElementChild?.textContent,
      value: row.firstElementChild?.nextElementSibling?.textContent,
    }));
}

describe("asset overview custom fields card", () => {
  it("shows a Link value as a chip among the other fields, in name order", async () => {
    renderCard({ canEditAsset: false });

    expect(await cardRows()).toEqual([
      { label: "Manual", value: "PDFSharePoint" },
      { label: "Serial number", value: "ABC-123" },
    ]);
    expect(
      screen.getByRole("link", { name: "PDF, SharePoint" })
    ).toHaveAttribute(
      "href",
      "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?ref=shelf-webapp"
    );
  });

  it("names a Link field's chip with the title the loader sent for it", async () => {
    renderCard({ canEditAsset: false, manualUrl: MANUAL_URL });

    expect(
      await screen.findByRole("link", {
        name: "EOS R5 user manual, PDF, example-maker.com",
      })
    ).toHaveAttribute("href", `${MANUAL_URL}?ref=shelf-webapp`);
  });

  it("hides empty Link and plain fields from a member who cannot edit", async () => {
    renderCard({ canEditAsset: false });

    expect((await cardRows()).map((row) => row.label)).toEqual([
      "Manual",
      "Serial number",
    ]);
    expect(screen.queryByText("Not set")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Name this link" })).toBeNull();
  });

  it("shows an editor an empty Link field as Not set, like a plain field", async () => {
    renderCard({ canEditAsset: true });

    expect(await cardRows()).toEqual([
      { label: "Calibration certificate", value: "Not set" },
      { label: "Manual", value: "PDFSharePoint" },
      { label: "Notes", value: "Not set" },
      { label: "Serial number", value: "ABC-123" },
    ]);
    expect(
      screen.getByRole("button", { name: "Edit Calibration certificate" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Notes" })
    ).toBeInTheDocument();
  });

  it("lets editors name a Link field's link from its chip", async () => {
    renderCard({ canEditAsset: true });

    await cardRows();
    expect(
      screen.getAllByRole("button", { name: "Name this link" })
    ).toHaveLength(1);
  });
});
