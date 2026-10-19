/**
 * Tests for the custom field inputs on the asset form.
 *
 * Focus: a required OPTION field that fails validation must show its message
 * next to the picker, because its value lives in a hidden input and the
 * browser cannot surface the problem on its own.
 */
import { cleanup, render, screen } from "@testing-library/react";
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

function renderFields(fieldErrors: Record<string, string | undefined>) {
  useLoaderDataMock.mockReturnValue({
    customFields: [owningCompany],
    asset: { customFields: [] },
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
});
