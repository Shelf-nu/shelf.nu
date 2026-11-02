/**
 * ImportErrorDetails - unit tests
 *
 * Verifies that each kind of problem the server attaches to an import error
 * renders its own table, and that the title, message and footer always show.
 *
 * @see {@link file://./import-error-details.tsx}
 */
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { ImportErrorDetails } from "./import-error-details";

/**
 * Renders inside a data router: the shared `Table` reads loader data and the
 * location. The stub route resolves asynchronously, so tests await content.
 */
function renderDetails(ui: ReactElement) {
  const Stub = createRoutesStub([{ path: "/", Component: () => ui }]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("ImportErrorDetails", () => {
  it("renders the title, message and footer without extra data", async () => {
    renderDetails(
      <ImportErrorDetails error={{ title: "Bad file", message: "Nope" }} />
    );

    expect(await screen.findByText("Bad file")).toBeInTheDocument();
    expect(await screen.findByText("Nope")).toBeInTheDocument();
    expect(
      await screen.findByText(/Please fix your CSV file/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the row-error table from additionalData.rowErrors", async () => {
    renderDetails(
      <ImportErrorDetails
        error={{
          message: "Invalid rows",
          additionalData: {
            rowErrors: [{ row: 3, title: "Bad", message: "Quantity missing" }],
            totalErrors: 120,
          },
        }}
      />
    );

    expect(await screen.findByText("Quantity missing")).toBeInTheDocument();
    expect(
      await screen.findByText(/Showing the first 1 of 120 problems/)
    ).toBeInTheDocument();
  });

  it("renders the QR table from additionalData.linkedCodes", async () => {
    renderDetails(
      <ImportErrorDetails
        error={{
          message: "QR problems",
          additionalData: {
            linkedCodes: [{ title: "Laptop", qrId: "qr-123" }],
          },
        }}
      />
    );

    expect(await screen.findByText("Already linked codes")).toBeInTheDocument();
    expect(await screen.findByText("qr-123")).toBeInTheDocument();
  });

  it("renders the headers table from additionalData.defectedHeaders", async () => {
    renderDetails(
      <ImportErrorDetails
        error={{
          message: "Header problems",
          additionalData: {
            defectedHeaders: [
              { incorrectHeader: "cf:Date", errorMessage: "Missing type" },
            ],
          },
        }}
      />
    );

    expect(await screen.findByText("Incorrect Header")).toBeInTheDocument();
    expect(await screen.findByText("cf:Date")).toBeInTheDocument();
    expect(await screen.findByText("Missing type")).toBeInTheDocument();
  });
});
