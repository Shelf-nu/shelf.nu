/**
 * MappingImportForm: the two-step import of `/assets/import`.
 *
 * Driven through a route stub whose action records every post, so the tests
 * see what the real route would receive: `intent=analyze` first, then, after
 * the review, `intent=content` with the reviewed mapping and the change count.
 * Edits survive Enter, and Back returns to the file step.
 *
 * happy-dom drops File values when a FormData body passes through a Request,
 * so the posted text fields are read from the action and the file is checked
 * on the input instead: it stays mounted, holding the picked File, so the
 * browser posts that same File with each step.
 *
 * @see {@link file://./mapping-import-form.tsx}
 * @see {@link file://./../../../routes/_layout+/assets.import.tsx} the real action
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnMapping } from "~/modules/import-mapping/types";
import type { MappingAnalysis } from "./mapping-import-form";
import { MappingImportForm } from "./mapping-import-form";

// why: the hook reads the `_layout` loader, which the stub does not mount
vi.mock("~/utils/permissions/use-barcode-permissions", () => ({
  useBarcodePermissions: () => ({ canUseBarcodes: false }),
}));

/** One recorded post: its text fields. */
type Post = Record<string, string>;

const ANALYSIS: MappingAnalysis = {
  proposal: {
    source: "rules",
    notes: [],
    columns: [
      {
        source: "Item Name",
        target: { kind: "field", name: "title" },
        confidence: "high",
        sample: ["Dell"],
      },
      {
        source: "Serial No.",
        target: { kind: "customField", name: "Serial number", type: "TEXT" },
        confidence: "high",
        sample: ["S1"],
      },
      {
        source: "Legacy ID",
        target: { kind: "skip" },
        confidence: "low",
        sample: ["X1"],
      },
    ],
  },
  rowCount: 2,
  alreadyMatches: false,
  columnStats: [
    { newCategories: 2, newLocations: 2 },
    { newCategories: 2, newLocations: 2 },
    { newCategories: 2, newLocations: 2 },
  ],
  existingCustomFields: [],
};

let posts: Post[] = [];

/** Renders the form on a stub route whose action records each post. */
function renderForm() {
  const Stub = createRoutesStub([
    {
      path: "/assets/import",
      Component: MappingImportForm,
      action: async ({ request }) => {
        const formData = await request.formData();
        const post: Post = {};
        formData.forEach((value, key) => {
          if (typeof value === "string") post[key] = value;
        });
        posts.push(post);
        return post.intent === "analyze"
          ? { ...ANALYSIS, error: null }
          : { success: true, error: null };
      },
    },
  ]);
  const view = render(<Stub initialEntries={["/assets/import"]} />);
  return { ...view, user: userEvent.setup() };
}

/** The file input, which stays mounted through both steps. */
function fileInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input missing");
  return input;
}

/** Picks a CSV in the file input. */
async function pickFile(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  name = "export.csv"
) {
  await user.upload(
    fileInput(container),
    new File(["Item Name\nDell\n"], name, { type: "text/csv" })
  );
}

/** Picks a file, presses Continue and waits for the review. */
async function reachReview(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement
) {
  await pickFile(user, container);
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Check how your columns map" });
}

beforeEach(() => {
  posts = [];
});

describe("MappingImportForm", () => {
  it("posts the file for analysis and shows the proposed mapping", async () => {
    const { user, container } = renderForm();
    await reachReview(user, container);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ intent: "analyze" });
    expect(posts[0]).not.toHaveProperty("mapping");
    expect(
      screen.getByRole("button", {
        name: "Shelf field for column Item Name: Title",
      })
    ).toBeTruthy();
  });

  it("keeps the review and its edits when Enter is pressed in a name", async () => {
    const { user, container } = renderForm();
    await reachReview(user, container);

    const name = screen.getByRole("textbox", { name: "Custom field name" });
    await user.clear(name);
    await user.type(name, "Serial code{Enter}");

    // No second analyze post, and the typed name is still there.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts).toHaveLength(1);
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Custom field name",
      }).value
    ).toBe("Serial code");
  });

  it("goes Back to the file step and analyses the next file afresh", async () => {
    const { user, container } = renderForm();
    await reachReview(user, container);

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.queryByRole("heading", { name: "Check how your columns map" })
    ).toBeNull();

    await pickFile(user, container, "second.csv");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Check how your columns map" });
    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({ intent: "analyze" });
    expect(fileInput(container).files?.[0]?.name).toBe("second.csv");
  });

  it("imports the same file with the reviewed mapping and the change count", async () => {
    const { user, container } = renderForm();
    await reachReview(user, container);

    await user.click(
      screen.getByRole("button", {
        name: "Shelf field for column Legacy ID: Skip",
      })
    );
    await user.click(screen.getByRole("option", { name: /^Location/ }));

    await user.click(screen.getByRole("button", { name: "Import" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox"), "I AGREE");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await waitFor(() => expect(posts).toHaveLength(2));
    const imported = posts[1];
    expect(imported).toMatchObject({ intent: "content", mappingChanged: "1" });
    // The picked file is still on the mounted input the import form posts.
    expect(fileInput(container).files?.[0]?.name).toBe("export.csv");
    const mapping = JSON.parse(imported.mapping) as ColumnMapping[];
    expect(mapping.map((column) => column.target)).toEqual([
      { kind: "field", name: "title" },
      { kind: "customField", name: "Serial number", type: "TEXT" },
      { kind: "field", name: "location" },
    ]);
    expect(await within(dialog).findByText("Success!")).toBeTruthy();
  });

  it("blocks Import while two columns share a field", async () => {
    const { user, container } = renderForm();
    await reachReview(user, container);

    await user.click(
      screen.getByRole("button", {
        name: "Shelf field for column Legacy ID: Skip",
      })
    );
    await user.click(screen.getByRole("option", { name: /^Title/ }));

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Import" }).disabled
    ).toBe(true);
    expect(screen.getAllByText(/Another column already goes/)).toHaveLength(2);
  });
});
