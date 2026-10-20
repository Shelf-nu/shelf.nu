/**
 * Field Selector UI Tests
 *
 * The column picker inside a filter row offers only columns the caller can
 * filter on. "Last audit date" is listed only when the workspace's audits are
 * queryable for the caller.
 *
 * @see {@link file://./field-selector.tsx}
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LastAuditDateAccess } from "~/modules/asset/last-audit-date-access";

import { FieldSelector } from "./field-selector";

const loaderData = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

// why: the picker reads the index loader's columns and audit access; the
// route tree is not mounted in a unit test.
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useLoaderData: () => loaderData.current };
});

/** Seeds the loader data with a status column and the last audit date column. */
function seed(lastAuditDateAccess: LastAuditDateAccess) {
  loaderData.current = {
    lastAuditDateAccess,
    settings: {
      columns: [
        { name: "status", visible: true, position: 0 },
        { name: "lastAuditDate", visible: true, position: 1 },
      ],
    },
  };
}

/** Renders a fresh filter row and opens its column picker. */
async function openPicker() {
  render(
    <FieldSelector
      filter={{
        name: "",
        operator: "is",
        value: "",
        type: "string",
        isNew: true,
      }}
      filters={[]}
      setFilter={vi.fn()}
    />
  );
  await userEvent.click(screen.getByRole("button", { name: /select column/i }));
}

describe("FieldSelector", () => {
  beforeEach(() => {
    loaderData.current = {};
  });

  it("offers the last audit date when audits are available", async () => {
    seed("available");

    await openPicker();

    expect(screen.getByText("Last audit date")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it.each(["locked", "hidden"] as const)(
    "does not offer the last audit date when access is %s",
    async (access) => {
      seed(access);

      await openPicker();

      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.queryByText("Last audit date")).not.toBeInTheDocument();
    }
  );
});
