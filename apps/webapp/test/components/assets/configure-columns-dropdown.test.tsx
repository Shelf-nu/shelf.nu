/**
 * Pins the form the Columns popover posts to `/api/asset-index-settings`:
 * one `columns[i][name|position|visible]` group per column in list order, plus
 * `cfType` for custom fields only, and the effect of a keyboard move and a
 * visibility toggle on it.
 *
 * @see {@link file://./../../../app/components/assets/assets-index/configure-columns-dropdown.tsx}
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigureColumnsDropdown } from "~/components/assets/assets-index/configure-columns-dropdown";

const dragStart = vi.hoisted(() => vi.fn());
vi.mock("framer-motion", async () => ({
  ...(await vi.importActual<object>("framer-motion")),
  // why: real DragControls need layout measurement happy-dom does not provide;
  // the spy shows which pointer-down starts a drag.
  useDragControls: () => ({ start: dragStart, subscribe: () => () => {} }),
}));

const COLUMNS = [
  { name: "status", visible: true, position: 0 },
  { name: "cf_Serial", visible: false, position: 1, cfType: "TEXT" },
  { name: "createdAt", visible: true, position: 2 },
];

/** Renders the popover on /assets and captures what its form posts. */
function renderDropdown() {
  const posted: FormData[] = [];
  const Stub = createRoutesStub([
    {
      path: "/assets",
      Component: ConfigureColumnsDropdown,
      loader: () => ({ settings: { mode: "ADVANCED", columns: COLUMNS } }),
    },
    {
      path: "/api/asset-index-settings",
      action: async ({ request }) => {
        posted.push(await request.formData());
        return { ok: true };
      },
    },
  ]);
  render(<Stub initialEntries={["/assets"]} />);
  return posted;
}

async function openPopover() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Columns configuration" })
  );
  return screen.findByRole("list", { name: "Reorderable columns list" });
}

/** Collapses the posted `columns[i][field]` entries into one row per column. */
function postedColumns(form: FormData) {
  const rows: Record<string, string>[] = [];
  for (const [key, value] of form.entries()) {
    const match = key.match(/^columns\[(\d+)\]\[(\w+)\]$/);
    if (!match) continue;
    const index = Number(match[1]);
    rows[index] = { ...rows[index], [match[2]]: String(value) };
  }
  return rows;
}

describe("ConfigureColumnsDropdown", () => {
  beforeEach(() => dragStart.mockClear());

  it("starts a drag only from the handle, not from the column label", async () => {
    renderDropdown();
    await openPopover();
    const label = screen.getByRole("checkbox", { name: /Status/ });

    fireEvent.pointerDown(label);
    expect(dragStart).not.toHaveBeenCalled();
    // framer marks a row that drags from anywhere with touch-action: pan-x.
    expect(label.closest("li")?.style.touchAction).not.toBe("pan-x");

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Reorder Status" })
    );
    expect(dragStart).toHaveBeenCalledTimes(1);
  });

  it("posts the new order and visibility after a keyboard move and a toggle", async () => {
    const posted = renderDropdown();
    await openPopover();

    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Status" }), {
      key: "ArrowDown",
      altKey: true,
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Serial/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].get("intent")).toBe("changeColumns");
    expect(postedColumns(posted[0])).toEqual([
      { cfType: "TEXT", name: "cf_Serial", position: "0", visible: "on" },
      { name: "status", position: "1", visible: "on" },
      { name: "createdAt", position: "2", visible: "on" },
    ]);
  });

  it("shows the keyboard shortcut", async () => {
    renderDropdown();
    await openPopover();
    expect(screen.getByText("Drag or Alt + ↑ / ↓ to reorder")).toBeVisible();
  });
});
