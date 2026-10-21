/**
 * ContentImportFlow - component tests
 *
 * Renders the flow in a router stub whose action answers like the real
 * `assets.import` route: a preview payload, or an error payload. Asserts what
 * the user sees across the upload and preview stages, where focus goes when the
 * stage changes, that a refused confirm belongs to the dialog opening that
 * sent it, and that the grid pages through the draft with "Load more".
 *
 * @see {@link file://./flow.tsx}
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ContentImportPreview,
  ImportGridRow,
} from "~/modules/asset-import/types";
import { ContentImportFlow } from "./flow";

const PREVIEW: ContentImportPreview = {
  importId: "import-1",
  fileName: "assets.csv",
  totalRows: 2,
  columns: ["Title", "Category"],
  rows: [
    {
      key: "r2",
      label: "Row 2",
      cells: {
        Title: { value: "Drill", tone: "plain" },
        Category: { value: "Power tools", tone: "new" },
      },
    },
    {
      key: "r3",
      label: "Row 3",
      cells: { Title: { value: "Saw", tone: "plain" } },
    },
  ],
  newEntities: {
    categories: ["Power tools"],
    locations: [],
    tags: [],
    kits: [],
    custodians: [],
    customFields: [],
    assetModels: [],
  },
  counts: { withImage: 1, withCustodian: 0, inKit: 0, quantityTracked: 0 },
  valueWarnings: [],
  totalValueWarnings: 0,
};

/**
 * Renders the flow with an action that returns `result` for every submit.
 *
 * @param result - The action data the stub answers with
 */
function renderFlow(result: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: ContentImportFlow,
      // why: there is no server in a component test; the action stands in for
      // the `assets.import` route action and returns its documented payloads
      action: () => Promise.resolve(result),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

/** Picks a CSV file and submits the upload form. */
async function uploadFile(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(["title\nDrill"], "assets.csv", { type: "text/csv" });
  await user.upload(screen.getByLabelText(/select a csv file/i), file);
  await user.click(screen.getByRole("button", { name: /preview import/i }));
}

describe("ContentImportFlow", () => {
  it("keeps the preview button disabled until a file is chosen", async () => {
    renderFlow({ error: null, intent: "preview", preview: PREVIEW });

    expect(
      await screen.findByRole("button", { name: /preview import/i })
    ).toBeDisabled();
  });

  it("shows the preview stage when the upload is accepted", async () => {
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: PREVIEW });

    await uploadFile(user);

    expect(
      await screen.findByRole("button", { name: "Import 2 assets" })
    ).toBeInTheDocument();
    expect(screen.getByText("2 assets")).toBeInTheDocument();
    expect(screen.getByText("1 with images")).toBeInTheDocument();
    expect(
      screen.getByText("Power tools", { selector: "span.font-mono" })
    ).toBeInTheDocument();
  });

  it("lists External QR value warnings above the grid and keeps Import enabled", async () => {
    const user = userEvent.setup();
    renderFlow({
      error: null,
      intent: "preview",
      preview: {
        ...PREVIEW,
        valueWarnings: [
          {
            row: 2,
            title: "External QR value",
            message: '"example.com/abc" looks like a web address',
          },
        ],
        totalValueWarnings: 1,
      },
    });

    await uploadFile(user);

    expect(
      await screen.findByText(/1 barcode value may not match its label/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText('"example.com/abc" looks like a web address')
    ).toBeInTheDocument();
    expect(screen.getByText("Check this value")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Check" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import 2 assets" })
    ).toBeEnabled();
  });

  it("shows no warning notice when the file has no value warnings", async () => {
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: PREVIEW });

    await uploadFile(user);

    await screen.findByRole("button", { name: "Import 2 assets" });
    expect(screen.queryByText(/may not match/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Check this value")).not.toBeInTheDocument();
  });

  it("moves focus to the preview heading when the preview loads", async () => {
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: PREVIEW });

    await uploadFile(user);

    const heading = await screen.findByRole("heading", {
      name: "Preview of assets.csv",
    });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("moves focus back to the file input from 'Choose a different file'", async () => {
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: PREVIEW });

    await uploadFile(user);
    await user.click(
      await screen.findByRole("button", { name: /choose a different file/i })
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/select a csv file/i)).toHaveFocus()
    );
  });

  it("renders the server error under the file input", async () => {
    const user = userEvent.setup();
    renderFlow({
      error: {
        title: "Import error",
        message: "Duplicate asset titles in the file",
        label: "Assets",
      },
    });

    await uploadFile(user);

    expect(
      await screen.findByText("Duplicate asset titles in the file")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Import \d+ assets$/ })
    ).not.toBeInTheDocument();
  });

  it("returns to the upload stage from 'Choose a different file'", async () => {
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: PREVIEW });

    await uploadFile(user);
    await user.click(
      await screen.findByRole("button", { name: /choose a different file/i })
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Import 2 assets" })
      ).not.toBeInTheDocument()
    );
    expect(
      screen.getByRole("button", { name: /preview import/i })
    ).toBeDisabled();
  });

  describe("confirming", () => {
    /** Renders the flow; the second submit (confirm) answers with `confirmResult`. */
    function renderWithConfirm(confirmResult: unknown) {
      const confirmBodies: URLSearchParams[] = [];
      let calls = 0;
      const Stub = createRoutesStub([
        {
          path: "/",
          Component: ContentImportFlow,
          // why: no server in a component test; the first submit is the
          // upload, the next is the confirm and its body is recorded
          action: async ({ request }) => {
            calls += 1;
            if (calls === 1) {
              return { error: null, intent: "preview", preview: PREVIEW };
            }
            confirmBodies.push(new URLSearchParams(await request.text()));
            return confirmResult;
          },
        },
      ]);
      render(<Stub initialEntries={["/"]} />);
      return confirmBodies;
    }

    /** Opens the confirm dialog and confirms with the typed phrase. */
    async function confirm(user: ReturnType<typeof userEvent.setup>) {
      await uploadFile(user);
      await user.click(
        await screen.findByRole("button", { name: "Import 2 assets" })
      );
      await user.type(screen.getByLabelText("Confirmation"), "i agree");
      await user.click(screen.getByRole("button", { name: "Import" }));
    }

    it("submits intent=confirm with the draft import id", async () => {
      const user = userEvent.setup();
      const bodies = renderWithConfirm({ error: null });

      await confirm(user);

      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0].get("intent")).toBe("confirm");
      expect(bodies[0].get("importId")).toBe("import-1");
    });

    it("shows a refused confirm inside the dialog", async () => {
      const user = userEvent.setup();
      renderWithConfirm({
        error: {
          title: "Import error",
          message: "Another import is already running",
          label: "Assets",
        },
      });

      await confirm(user);

      const dialog = await screen.findByRole("alertdialog");
      expect(
        await within(dialog).findByText("Another import is already running")
      ).toBeInTheDocument();
    });

    it("does not show a refusal from an earlier opening on a fresh one", async () => {
      const user = userEvent.setup();
      renderWithConfirm({
        error: {
          title: "Import error",
          message: "Another import is already running",
          label: "Assets",
        },
      });

      await confirm(user);
      const dialog = await screen.findByRole("alertdialog");
      await within(dialog).findByText("Another import is already running");

      // Dismiss the dialog, then open it again without confirming.
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
      );
      await user.click(screen.getByRole("button", { name: "Import 2 assets" }));

      const reopened = await screen.findByRole("alertdialog");
      expect(
        within(reopened).queryByText("Another import is already running")
      ).not.toBeInTheDocument();
    });
  });
});

describe("preview grid paging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** `count` plain grid rows starting at stored row `from`. */
  function gridRows(from: number, count: number): ImportGridRow[] {
    return Array.from({ length: count }, (_, index) => ({
      key: `k${from + index}`,
      label: String(from + index + 2),
      cells: { Title: { value: `Asset ${from + index}`, tone: "plain" } },
    }));
  }

  /** A preview of a 250-row file carrying its first 100 rows. */
  const LARGE_PREVIEW: ContentImportPreview = {
    ...PREVIEW,
    totalRows: 250,
    columns: ["Title", "Category"],
    rows: gridRows(0, 100),
    newEntities: { ...PREVIEW.newEntities, categories: [] },
  };

  /** Body rows of the preview grid (the header row excluded). */
  function bodyRows() {
    return within(screen.getByRole("table", { name: "Import preview" }))
      .getAllByRole("row")
      .slice(1);
  }

  it("renders the first 100 rows and how many the file has", async () => {
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: LARGE_PREVIEW });

    await uploadFile(user);

    await screen.findByRole("button", { name: "Import 250 assets" });
    expect(bodyRows()).toHaveLength(100);
    expect(screen.getByText("Showing 100 of 250 rows")).toBeInTheDocument();
  });

  it("loads the next page from the draft and appends it", async () => {
    // why: "Load more" reads an api+ endpoint with fetch; there is no server
    // in a component test, so the endpoint's documented payload stands in.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: null,
          rows: [
            ...gridRows(100, 99),
            {
              key: "k199",
              label: "201",
              cells: {
                Title: { value: "Asset 199", tone: "plain" },
                Category: {
                  value: "Fresh",
                  tone: "new",
                  note: "Will be created",
                },
              },
            },
          ],
          nextOffset: 200,
        })
      )
    );
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: LARGE_PREVIEW });

    await uploadFile(user);
    await user.click(
      await screen.findByRole("button", { name: "Load 100 more" })
    );

    await waitFor(() => expect(bodyRows()).toHaveLength(200));
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "/api/asset-imports/import-1/preview-rows?offset=100"
    );
    expect(screen.getByText("Asset 199")).toBeInTheDocument();
    expect(screen.getByText("Showing 200 of 250 rows")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Load 50 more" })
    ).toBeInTheDocument();
    // A loaded page with a new value brings the legend entry with it.
    expect(
      screen.getByText("New: will be created on import")
    ).toBeInTheDocument();
  });

  it("shows the endpoint's refusal and keeps the rows it has", async () => {
    // why: no server in a component test; the endpoint's error payload
    // stands in for an expired draft.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Import not found. Upload the file again.",
            label: "Asset Import",
          },
        }),
        { status: 404 }
      )
    );
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: LARGE_PREVIEW });

    await uploadFile(user);
    await user.click(
      await screen.findByRole("button", { name: "Load 100 more" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Import not found. Upload the file again."
    );
    expect(bodyRows()).toHaveLength(100);
    expect(screen.getByRole("button", { name: "Load 100 more" })).toBeEnabled();
  });

  it("leaves the 'new' legend entry out when no loaded cell is new", async () => {
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: LARGE_PREVIEW });

    await uploadFile(user);

    await screen.findByRole("button", { name: "Import 250 assets" });
    expect(
      screen.queryByText("New: will be created on import")
    ).not.toBeInTheDocument();
  });

  it("shows the 'new' legend entry when a cell will be created", async () => {
    const user = userEvent.setup();
    renderFlow({ error: null, intent: "preview", preview: PREVIEW });

    await uploadFile(user);

    expect(
      await screen.findByText("New: will be created on import")
    ).toBeInTheDocument();
  });
});
