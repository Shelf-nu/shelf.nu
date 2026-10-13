import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import Input from "~/components/forms/input";

function renderDescription(defaultValue: string) {
  render(
    <Input
      label="Description"
      inputType="textarea"
      name="description"
      defaultValue={defaultValue}
      characterLimit={5000}
    />
  );
  return screen.getByLabelText("Description") as HTMLTextAreaElement;
}

describe("Input characterLimit", () => {
  it("counts the stored text, with each line break counted once", () => {
    renderDescription(`${"a".repeat(1508)}\r\nb`);

    expect(screen.getByTestId("character-count")).toHaveTextContent(
      "1,510 / 5,000"
    );
  });

  it("keeps text longer than the limit editable", async () => {
    const textarea = renderDescription("a".repeat(7497));
    const user = userEvent.setup();

    await user.click(textarea);
    await user.keyboard("{End}b");

    expect(textarea).not.toHaveAttribute("maxlength");
    expect(textarea.value).toHaveLength(7498);
    expect(screen.getByTestId("character-count")).toHaveTextContent(
      "7,498 / 5,000"
    );
  });

  it("updates the counter as the user types past the limit", async () => {
    const textarea = renderDescription("a".repeat(4999));
    const user = userEvent.setup();

    await user.click(textarea);
    await user.paste("bc");

    expect(screen.getByTestId("character-count")).toHaveTextContent(
      "5,001 / 5,000"
    );
    expect(screen.getByTestId("character-count")).toHaveClass("text-error-600");
  });

  it("keeps the caller's description and adds the counter to it", () => {
    render(
      <>
        <p id="description-help">Shown on the asset page</p>
        <Input
          label="Description"
          inputType="textarea"
          name="description"
          aria-describedby="description-help"
          characterLimit={5000}
        />
      </>
    );

    expect(screen.getByLabelText("Description")).toHaveAttribute(
      "aria-describedby",
      "description-help description-character-count"
    );
  });

  it("leaves a textarea without a limit at the default 250 maxlength and no counter", () => {
    render(<Input label="Notes" inputType="textarea" name="notes" />);

    expect(screen.getByLabelText("Notes")).toHaveAttribute("maxlength", "250");
    expect(screen.queryByTestId("character-count")).toBeNull();
  });
});
