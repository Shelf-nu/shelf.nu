/**
 * PresetListItem — unit tests
 *
 * The row decides what a viewer may do with a saved filter, and every branch of
 * that decision is invisible to the compiler: a shared preset and the viewer's
 * own render the same controls if the flags are read wrongly, and the server
 * then refuses the click with a 404 nobody expected.
 *
 *  - The viewer's own row carries a star, a rename and a delete.
 *  - A row someone else shared carries none of those, and says who shared it.
 *  - Managing the workspace's shared views adds the share toggle everywhere,
 *    and a delete on a shared row so an abandoned view can be retired.
 *
 * @see {@link file://./preset-list-item.tsx}
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, it, expect } from "vitest";
import { PresetListItem, type NormalizedPreset } from "./preset-list-item";

const ownPreset: NormalizedPreset = {
  id: "preset-1",
  name: "Cameras in Berlin",
  query: "status=AVAILABLE",
  starred: false,
  shared: false,
  isOwn: true,
  sharedByName: null,
};

const presetSharedByOther: NormalizedPreset = {
  ...ownPreset,
  id: "preset-2",
  name: "Regional stock",
  shared: true,
  isOwn: false,
  sharedByName: "Ada Byron",
};

/**
 * The row submits through `useFetcher`, which needs a router above it.
 *
 * why: react-router's fetcher hooks throw outside a data router; the stub is
 * the framework's own harness for that, so no application code is mocked.
 */
function renderRow(
  preset: NormalizedPreset,
  { canManageSharing = false }: { canManageSharing?: boolean } = {}
) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <PresetListItem
          preset={preset}
          isActive={false}
          canManageSharing={canManageSharing}
          columns={[]}
          formatPreview={() => <span />}
          onApply={() => {}}
          onRename={() => {}}
        />
      ),
      action: () => null,
    },
  ]);

  return render(<Stub initialEntries={["/"]} />);
}

describe("PresetListItem", () => {
  it("gives the viewer's own preset a star, a rename and a delete", () => {
    renderRow(ownPreset);

    expect(screen.getByTitle("Star")).toBeInTheDocument();
    expect(screen.getByTitle("Rename")).toBeInTheDocument();
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
  });

  it("renders a preset shared by someone else read-only", () => {
    renderRow(presetSharedByOther);

    expect(screen.getByText("Regional stock")).toBeInTheDocument();
    expect(screen.queryByTitle("Star")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Unstar")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Rename")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
  });

  it("names the person who shared it", () => {
    renderRow(presetSharedByOther);

    expect(screen.getByText("Shared by Ada Byron")).toBeInTheDocument();
  });

  it("offers no share toggle to a viewer who may not share", () => {
    renderRow(ownPreset);

    expect(screen.queryByTitle("Share with workspace")).not.toBeInTheDocument();
  });

  it("offers the share toggle on the viewer's own preset when they may share", () => {
    renderRow(ownPreset, { canManageSharing: true });

    expect(screen.getByTitle("Share with workspace")).toBeInTheDocument();
  });

  it("lets a workspace manager retire and delete someone else's shared preset", () => {
    renderRow(presetSharedByOther, { canManageSharing: true });

    expect(
      screen.getByTitle("Stop sharing with workspace")
    ).toBeInTheDocument();
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
    // Still not theirs to rename or star — the name and the shortcut are the
    // owner's.
    expect(screen.queryByTitle("Rename")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Star")).not.toBeInTheDocument();
  });
});
