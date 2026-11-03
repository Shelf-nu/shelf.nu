/**
 * The PDF templates card on Settings > Bookings.
 *
 * @see {@link file://./pdf-templates-settings.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      path: "/settings/bookings",
      Component: () => <PdfTemplatesSettings {...props} />,
    },
  ]);
  render(<Stub initialEntries={["/settings/bookings"]} />);
}

describe("PDF templates card", () => {
  it("lists the templates with their actions", async () => {
    renderCard({ templates: TEMPLATES, customFields: [] });

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

  /** Opens the edit dialog of the first template. */
  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    const rows = await screen.findAllByRole("listitem");
    await user.click(within(rows[0]).getByRole("button", { name: "Edit" }));
  }

  const FIELDS = [
    { id: "cf-serial", name: "Serial number", type: "TEXT", active: true },
    { id: "cf-old", name: "Old tag", type: "TEXT", active: false },
  ] as const;

  it("offers only active custom fields", async () => {
    const user = userEvent.setup();
    renderCard({ templates: TEMPLATES, customFields: [...FIELDS] });
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: /Custom field 1/ }));

    expect(screen.getByRole("option", { name: /Serial number/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /None/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /Old tag/ })).toBeNull();
  });

  it("shows a saved inactive field in its slot, marked inactive", async () => {
    const user = userEvent.setup();
    renderCard({
      templates: [
        {
          ...TEMPLATES[0],
          config: { ...TEMPLATES[0].config, customFieldIds: ["cf-old"] },
        },
      ],
      customFields: [...FIELDS],
    });
    await openEditor(user);

    const slot = screen.getByRole("button", { name: /Custom field 1/ });
    expect(slot).toHaveTextContent("Old tag");
    expect(slot).toHaveTextContent("inactive");
  });

  it("sorts and groups through plain selects without search", async () => {
    const user = userEvent.setup();
    renderCard({ templates: TEMPLATES, customFields: [] });
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: /Group by/ }));
    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
