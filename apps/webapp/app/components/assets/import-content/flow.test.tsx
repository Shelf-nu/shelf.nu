/**
 * ContentImportFlow - component tests
 *
 * Renders the flow in a router stub whose action answers like the real
 * `assets.import` route: a preview payload, or an error payload. Asserts what
 * the user sees across the upload and preview stages.
 *
 * @see {@link file://./flow.tsx}
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { ContentImportPreview } from "~/modules/asset-import/types";
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
  });
});
