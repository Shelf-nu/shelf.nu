import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormRowErrors } from "./form-row-errors";

describe("FormRowErrors", () => {
  it("renders nothing when no field has an error", () => {
    const { container } = render(
      <FormRowErrors id="errors" errors={[undefined, null, ""]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each error under the id the inputs point at", () => {
    render(
      <FormRowErrors
        id="errors"
        errors={["Name is required", undefined, "Enter a hex color"]}
      />
    );
    const list = document.getElementById("errors");
    expect(list).not.toBeNull();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Enter a hex color")).toBeInTheDocument();
    expect(list?.querySelectorAll("p")).toHaveLength(2);
  });
});
