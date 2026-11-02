/**
 * Tests for the custom field inputs on the asset form.
 *
 * Focus: a required OPTION field that fails validation must show its message
 * next to the picker, because its value lives in a hidden input and the
 * browser cannot surface the problem on its own. Picking an option never
 * fires the form `change` event Zorm re-validates on, so the picker itself
 * decides when a selection has resolved the error. A Link field's input is a
 * web address input, like the one on the asset overview.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssetCustomFields from "./custom-fields-inputs";

const { useLoaderDataMock } = vi.hoisted(() => ({
  useLoaderDataMock: vi.fn(),
}));

// why: the component reads custom field definitions from the route loader;
// the rest of react-router stays real because the shared Button renders Link
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLoaderData: () => useLoaderDataMock(),
  useNavigation: () => ({ state: "idle" }),
}));

// why: date preferences come from root loader data that is not under test
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({ prefs: {} }),
}));

// why: the markdown editor and date picker pull in heavy dependencies that
// have nothing to do with option field errors
vi.mock("../markdown/markdown-editor", () => ({
  MarkdownEditor: () => <div data-testid="markdown-editor" />,
}));
vi.mock("../shared/date-time-picker", () => ({
  DateTimePicker: () => <div data-testid="date-picker" />,
}));

const owningCompany = {
  id: "cf1",
  name: "Owning Company",
  helpText: null,
  required: true,
  type: "OPTION",
  options: ["ACME", "Globex"],
  active: true,
};

function renderFields(
  fieldErrors: Record<string, string | undefined>,
  storedValue?: string
) {
  useLoaderDataMock.mockReturnValue({
    customFields: [owningCompany],
    asset: {
      customFields: storedValue
        ? [
            {
              customFieldId: owningCompany.id,
              value: { raw: storedValue, valueOption: storedValue },
            },
          ]
        : [],
    },
  });
  // The "Manage custom fields" link needs a router context to render.
  return render(
    <MemoryRouter>
      <AssetCustomFields currency="USD" fieldErrors={fieldErrors} />
    </MemoryRouter>
  );
}

describe("AssetCustomFields option fields", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the validation message under a required option picker", () => {
    renderFields({ cf1: "Owning Company is required" });

    expect(screen.getByText("Owning Company is required")).toBeInTheDocument();
    const trigger = screen.getByRole("button", {
      name: /Choose Owning Company/,
    });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
  });

  it("renders no message when the option field is valid", () => {
    renderFields({});

    expect(
      screen.queryByText("Owning Company is required")
    ).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", {
      name: /Choose Owning Company/,
    });
    expect(trigger).not.toHaveAttribute("aria-invalid");
  });

  it("clears the message once an option is picked, and restores it on deselect", () => {
    renderFields({ cf1: "Owning Company is required" });
    const trigger = () =>
      screen.getByRole("button", { name: /Owning Company|ACME/ });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "ACME" }));

    expect(
      screen.queryByText("Owning Company is required")
    ).not.toBeInTheDocument();
    expect(trigger()).not.toHaveAttribute("aria-invalid");

    // Clicking the selected option again clears the selection.
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "ACME" }));

    expect(screen.getByText("Owning Company is required")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the message for a stored value that is no longer an option", () => {
    renderFields({ cf1: "Initech is not a valid option" }, "Initech");

    expect(
      screen.getByText("Initech is not a valid option")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Initech/ })).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });
});

describe("AssetCustomFields text fields", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("gives a Link field a web address input and leaves a plain one as typed text", () => {
    const textField = {
      helpText: "As printed on the label",
      required: false,
      type: "TEXT",
      options: [],
      active: true,
    };
    useLoaderDataMock.mockReturnValue({
      customFields: [
        { ...textField, id: "cf-manual", name: "Manual", format: "LINK" },
        { ...textField, id: "cf-serial", name: "Serial", format: "PLAIN" },
      ],
      asset: { customFields: [] },
    });
    render(
      <MemoryRouter>
        <AssetCustomFields currency="USD" fieldErrors={{}} />
      </MemoryRouter>
    );

    const manual = screen.getByRole("textbox", { name: "Manual" });
    expect(manual).toHaveAttribute("type", "text");
    expect(manual).toHaveAttribute("inputmode", "url");
    expect(manual).toHaveAttribute("placeholder", "https://");
    expect(manual).toHaveAttribute("autocomplete", "off");
    expect(manual).toHaveAttribute("spellcheck", "false");

    const serial = screen.getByRole("textbox", { name: "Serial" });
    expect(serial).not.toHaveAttribute("inputmode");
    expect(serial).toHaveAttribute("placeholder", "As printed on the label");
  });
});
