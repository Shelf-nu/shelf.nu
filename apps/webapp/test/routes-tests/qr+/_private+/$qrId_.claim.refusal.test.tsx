/**
 * The claim page shows why a claim was refused.
 *
 * The action can refuse a claim the page offered, for example when the
 * caller's role changed after the page loaded. The page must then show the
 * refusal rather than leave the form sitting there with no message.
 *
 * Rendered in a router stub, so submitting the form runs a real action round
 * trip and the assertion is what a user sees.
 *
 * @see {@link file://./../../../../app/routes/qr+/_private+/$qrId_.claim.tsx}
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, data } from "react-router";
import { describe, expect, it, vi } from "vitest";

import ClaimQrPage from "~/routes/qr+/_private+/$qrId_.claim";

// why: importing the route pulls the Prisma client transitively; the page's
// loader and action are replaced by the stubs below.
vi.mock("~/database/db.server", () => ({ db: {} }));

const REFUSAL = "You have no permission to perform this action";

describe("claim page", () => {
  it("shows the refusal when the claim is refused", async () => {
    const Stub = createRoutesStub([
      {
        path: "/qr/:qrId/claim",
        Component: ClaimQrPage,
        loader: () => ({
          header: { title: "Claim QR code for your organization" },
          qrId: "qr-1",
          organizations: [
            { id: "org-1", name: "Acme", type: "TEAM", imageId: null },
          ],
          currentOrganizationId: "org-1",
        }),
        action: () => data({ error: { message: REFUSAL } }, { status: 403 }),
      },
    ]);
    render(<Stub initialEntries={["/qr/qr-1/claim"]} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Confirm" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSAL);
  });
});
