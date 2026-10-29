/**
 * <CrossKitMoveNotice> and getCrossKitMoves - unit tests
 *
 * Covers which selected assets the kit "Add assets" confirm names as leaving
 * another kit, and what the notice says:
 *  - an INDIVIDUAL asset in another kit is named with that kit,
 *  - QUANTITY_TRACKED assets, assets already in this kit and rows seeded from
 *    the kit's own members are not,
 *  - the notice renders nothing when nothing moves,
 *  - singular and plural copy, one kit or several, and the "and N more"
 *    overflow.
 *
 * @see {@link file://./cross-kit-move-notice.tsx}
 */

import { AssetType } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CrossKitMoveCandidate } from "./cross-kit-move-notice";
import { CrossKitMoveNotice, getCrossKitMoves } from "./cross-kit-move-notice";

const THIS_KIT = { id: "kit_this", name: "Box 1 core" };
const OTHER_KIT = { id: "kit_other", name: "Box 1" };

/** A picker row as the asset list delivers it. */
function row(overrides: Partial<CrossKitMoveCandidate>): CrossKitMoveCandidate {
  return {
    id: "asset_1",
    title: "Camera A",
    type: AssetType.INDIVIDUAL,
    assetKits: [],
    ...overrides,
  };
}

describe("getCrossKitMoves", () => {
  it("names an individual asset that sits in another kit", () => {
    const moves = getCrossKitMoves(
      [row({ assetKits: [{ kit: OTHER_KIT }] })],
      THIS_KIT.id
    );

    expect(moves).toEqual([
      {
        assetId: "asset_1",
        assetTitle: "Camera A",
        fromKitId: "kit_other",
        fromKitName: "Box 1",
      },
    ]);
  });

  it("skips quantity-tracked assets, which can sit in several kits", () => {
    const moves = getCrossKitMoves(
      [
        row({
          type: AssetType.QUANTITY_TRACKED,
          assetKits: [{ kit: OTHER_KIT }],
        }),
      ],
      THIS_KIT.id
    );

    expect(moves).toEqual([]);
  });

  it("skips assets already in this kit and assets in no kit", () => {
    const moves = getCrossKitMoves(
      [
        row({ id: "in_this", assetKits: [{ kit: THIS_KIT }] }),
        row({ id: "in_none", assetKits: [] }),
      ],
      THIS_KIT.id
    );

    expect(moves).toEqual([]);
  });

  it("skips rows seeded from the kit's own members, which carry no kits", () => {
    const moves = getCrossKitMoves([{ id: "seeded" }], THIS_KIT.id);

    expect(moves).toEqual([]);
  });
});

describe("<CrossKitMoveNotice>", () => {
  it("renders nothing when no asset moves", () => {
    const { container } = render(<CrossKitMoveNotice moves={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names one moving asset and the kit it leaves", () => {
    render(
      <CrossKitMoveNotice
        moves={[
          {
            assetId: "a",
            assetTitle: "Camera A",
            fromKitId: "k1",
            fromKitName: "Box 1",
          },
        ]}
      />
    );

    expect(screen.getByText(/Kit move notice:/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /This asset leaves its current kit: Camera A \(from Box 1\)\. It also comes off any draft or reserved bookings that kit is on/
      )
    ).toBeInTheDocument();
  });

  it("names the first three moves and counts the rest", () => {
    render(
      <CrossKitMoveNotice
        moves={["A", "B", "C", "D", "E"].map((name) => ({
          assetId: name,
          assetTitle: `Item ${name}`,
          fromKitId: "k2",
          fromKitName: "Box 2",
        }))}
      />
    );

    expect(
      screen.getByText(
        /These 5 assets leave their current kit: Item A \(from Box 2\), Item B \(from Box 2\), Item C \(from Box 2\) and 2 more\. They also come off any draft or reserved bookings that kit is on/
      )
    ).toBeInTheDocument();
  });

  it("speaks of several kits when the assets leave different kits", () => {
    render(
      <CrossKitMoveNotice
        moves={[
          {
            assetId: "a",
            assetTitle: "Camera A",
            fromKitId: "k1",
            fromKitName: "Box 1",
          },
          {
            assetId: "b",
            assetTitle: "Mic",
            fromKitId: "k2",
            fromKitName: "Box 2",
          },
        ]}
      />
    );

    expect(
      screen.getByText(
        /These 2 assets leave their current kits: Camera A \(from Box 1\), Mic \(from Box 2\)\. They also come off any draft or reserved bookings those kits are on/
      )
    ).toBeInTheDocument();
  });

  it("counts two kits that share a name as two kits", () => {
    render(
      <CrossKitMoveNotice
        moves={[
          {
            assetId: "a",
            assetTitle: "Lens",
            fromKitId: "k1",
            fromKitName: "Camera Kit",
          },
          {
            assetId: "b",
            assetTitle: "Body",
            fromKitId: "k2",
            fromKitName: "Camera Kit",
          },
        ]}
      />
    );

    expect(
      screen.getByText(
        /leave their current kits: .* draft or reserved bookings those kits are on/
      )
    ).toBeInTheDocument();
  });
});
