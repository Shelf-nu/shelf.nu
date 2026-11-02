/**
 * The booking Name field focuses itself on mount only where a booking is
 * being created, never on the edit form a booking's overview opens with.
 *
 * @see {@link file://./name.tsx}
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NameField } from "./name";

describe("NameField", () => {
  it("focuses the name on mount by default, for the create forms", async () => {
    render(<NameField name={undefined} fieldName="name" onChange={() => {}} />);

    const input = screen.getByRole("textbox", { name: "Name" });
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("leaves focus alone with focusOnMount off, as the edit form renders it", async () => {
    render(
      <NameField
        name="Field trip"
        fieldName="name"
        focusOnMount={false}
        onChange={() => {}}
      />
    );

    const input = screen.getByRole("textbox", { name: "Name" });
    // Give a deferred focus the same chance the first test waits for.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(input).not.toHaveFocus();
  });
});
