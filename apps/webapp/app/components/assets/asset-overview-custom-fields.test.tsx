/**
 * The asset overview's two custom field cards, fed by the same row pipeline
 * the route uses (`buildAssetOverviewCustomFields` then
 * `splitOverviewCustomFields`).
 *
 * A member who cannot edit sees every Link field in "Documents & links", the
 * empty ones as "Not linked", while plain fields stay in the custom fields
 * card and empty plain fields stay hidden from them. Only editors can name a
 * link from its chip.
 *
 * @see {@link file://./asset-overview-custom-fields.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { LINK_TITLES, MANUAL_URL } from "@helpers/link-titles";
import {
  buildAssetOverviewCustomFields,
  splitOverviewCustomFields,
  type CustomFieldDefinitionForDisplay,
} from "~/utils/custom-fields";
import {
  CustomFieldsCard,
  DocumentsAndLinksCard,
} from "./asset-overview-custom-fields";

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
 * Renders both cards the way the overview does, inside a router, with the
 * loader's `linkTitles` fixture.
 */
function renderCards({
  canEditAsset,
  manualUrl = "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12",
}: {
  canEditAsset: boolean;
  manualUrl?: string;
}) {
  const { linkRows, otherRows } = splitOverviewCustomFields(
    buildAssetOverviewCustomFields({
      storedValues: [
        {
          value: { raw: manualUrl, valueText: manualUrl },
          customField: manual,
        },
        {
          value: { raw: "ABC-123", valueText: "ABC-123" },
          customField: serial,
        },
      ],
      editableDefinitions: canEditAsset
        ? [manual, certificate, serial, notes]
        : [],
      listedDefinitions: [manual, certificate],
    })
  );
  const props = {
    titles: LINK_TITLES,
    canEditAsset,
    locale: "en-US",
    currency: "USD" as const,
  };
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <>
          <DocumentsAndLinksCard rows={linkRows} {...props} />
          <CustomFieldsCard rows={otherRows} {...props} />
        </>
      ),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

/** The card element that holds `text`. */
function cardOf(text: string) {
  return screen.getByText(text).closest<HTMLElement>(".card")!;
}

describe("asset overview custom field cards", () => {
  it("lists every Link field for a member who cannot edit, empty ones as Not linked", async () => {
    renderCards({ canEditAsset: false });

    const documents = await screen.findByRole("heading", {
      name: "Documents & links",
    });
    const card = within(documents.closest<HTMLElement>(".card")!);
    expect(card.getByText("Calibration certificate")).toBeInTheDocument();
    expect(card.getByText("Not linked")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "PDF, SharePoint" })).toHaveAttribute(
      "href",
      "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?ref=shelf-webapp"
    );
    expect(card.queryByText("Serial number")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Name this link" })).toBeNull();
  });

  it("names a Link field's chip with the title the loader sent for it", async () => {
    renderCards({ canEditAsset: false, manualUrl: MANUAL_URL });

    const documents = await screen.findByRole("heading", {
      name: "Documents & links",
    });
    expect(
      within(documents.closest<HTMLElement>(".card")!).getByRole("link", {
        name: "EOS R5 user manual, PDF, example-maker.com",
      })
    ).toHaveAttribute("href", `${MANUAL_URL}?ref=shelf-webapp`);
  });

  it("keeps plain fields in the custom fields card and hides empty ones from a member who cannot edit", async () => {
    renderCards({ canEditAsset: false });

    await screen.findByText("Serial number");
    const card = within(cardOf("Serial number"));
    expect(card.getByText("ABC-123")).toBeInTheDocument();
    expect(card.queryByText("Manual")).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText("Not set")).toBeNull();
  });

  it("offers editors an editor for an empty Link field", async () => {
    renderCards({ canEditAsset: true });

    expect(
      await screen.findByRole("button", {
        name: "Edit Calibration certificate",
      })
    ).toBeInTheDocument();
    expect(within(cardOf("Notes")).getByText("Not set")).toBeInTheDocument();
  });

  it("lets editors name a link from its chip in Documents & links", async () => {
    renderCards({ canEditAsset: true });

    const documents = await screen.findByRole("heading", {
      name: "Documents & links",
    });
    expect(
      within(documents.closest<HTMLElement>(".card")!).getAllByRole("button", {
        name: "Name this link",
      })
    ).toHaveLength(1);
  });
});
