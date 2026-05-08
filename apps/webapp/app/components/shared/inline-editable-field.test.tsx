/**
 * Tests for InlineEditableField — the click-to-edit wrapper used on the
 * asset overview page.
 *
 * @see {@link file://./inline-editable-field.tsx}
 */
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { InlineEditableField } from "./inline-editable-field";

/**
 * Mock useFetcher so we control fetcher state per test.
 * We track the latest fetcher state via a module-level variable that
 * tests can reassign before rendering.
 */
let mockFetcherState: {
  state: "idle" | "submitting" | "loading";
  data: unknown;
} = { state: "idle", data: undefined };

// why: useFetcher returns a Form component plus state we need to control
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useFetcher: () => ({
      ...mockFetcherState,
      Form: ({
        children,
        ...rest
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => <form {...rest}>{children}</form>,
      submit: vi.fn(),
      load: vi.fn(),
    }),
  };
});

// why: useDisabled depends on react-router's useNavigation; mock to a stable false
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

const renderField = (
  overrides: Partial<Parameters<typeof InlineEditableField>[0]> = {}
) =>
  render(
    <ul>
      <InlineEditableField
        fieldName="description"
        label="Description"
        canEdit
        renderDisplay={() => <span>Hello world</span>}
        renderEditor={() => (
          <input type="text" name="fieldValue" defaultValue="Hello world" />
        )}
        {...overrides}
      />
    </ul>
  );

describe("InlineEditableField", () => {
  beforeEach(() => {
    mockFetcherState = { state: "idle", data: undefined };
  });

  describe("display mode", () => {
    it("renders the display value", () => {
      renderField();
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("renders the field label", () => {
      renderField();
      expect(screen.getByText("Description")).toBeInTheDocument();
    });

    it("shows an Edit pencil button when user can edit", () => {
      renderField();
      expect(
        screen.getByRole("button", { name: "Edit Description" })
      ).toBeInTheDocument();
    });

    it("hides the Edit pencil button when user cannot edit", () => {
      renderField({ canEdit: false });
      expect(
        screen.queryByRole("button", { name: "Edit Description" })
      ).not.toBeInTheDocument();
    });

    it("hides the entire row when isEmpty and user cannot edit", () => {
      const { container } = renderField({
        canEdit: false,
        isEmpty: true,
      });
      expect(container.querySelector("li")).not.toBeInTheDocument();
    });

    it("renders the row when isEmpty but user can edit", () => {
      renderField({ isEmpty: true });
      expect(screen.getByText("Hello world")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit Description" })
      ).toBeInTheDocument();
    });
  });

  describe("entering edit mode", () => {
    it("clicking the pencil button reveals the editor", () => {
      renderField();
      fireEvent.click(screen.getByRole("button", { name: "Edit Description" }));
      expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Cancel" })
      ).toBeInTheDocument();
    });

    it("renders required hidden inputs (intent and fieldName) inside the form", () => {
      const { container } = renderField();
      fireEvent.click(screen.getByRole("button", { name: "Edit Description" }));
      const intentInput = container.querySelector(
        'input[name="intent"]'
      ) as HTMLInputElement;
      const fieldNameInput = container.querySelector(
        'input[name="fieldName"]'
      ) as HTMLInputElement;
      expect(intentInput?.value).toBe("updateField");
      expect(fieldNameInput?.value).toBe("description");
    });

    it("includes extraHiddenInputs in the form", () => {
      const { container } = renderField({
        extraHiddenInputs: { customFieldId: "cf_123" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Edit Description" }));
      const customFieldIdInput = container.querySelector(
        'input[name="customFieldId"]'
      ) as HTMLInputElement;
      expect(customFieldIdInput?.value).toBe("cf_123");
    });

    it("uses formFieldName for the hidden fieldName input when provided", () => {
      const { container } = renderField({
        fieldName: "customField-cf_123",
        formFieldName: "customField",
        extraHiddenInputs: { customFieldId: "cf_123" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Edit Description" }));
      const fieldNameInputs = container.querySelectorAll(
        'input[name="fieldName"]'
      );
      expect(fieldNameInputs.length).toBe(1);
      expect((fieldNameInputs[0] as HTMLInputElement).value).toBe(
        "customField"
      );
    });
  });

  describe("exiting edit mode", () => {
    it("clicking Cancel returns to display mode", () => {
      renderField();
      fireEvent.click(screen.getByRole("button", { name: "Edit Description" }));
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        screen.queryByRole("button", { name: "Save" })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit Description" })
      ).toBeInTheDocument();
    });

    it("Escape key exits edit mode", () => {
      const { container } = renderField();
      fireEvent.click(screen.getByRole("button", { name: "Edit Description" }));
      const form = container.querySelector("form");
      expect(form).toBeInTheDocument();
      fireEvent.keyDown(form!, { key: "Escape" });
      expect(
        screen.queryByRole("button", { name: "Save" })
      ).not.toBeInTheDocument();
    });
  });

  describe("error handling", () => {
    it("displays the server error after submitting a form that returned an error", () => {
      mockFetcherState = {
        state: "idle",
        data: { error: { message: "Value must be a valid number" } },
      };
      const { container } = renderField();
      fireEvent.click(screen.getByRole("button", { name: "Edit Description" }));
      // After clicking Edit, stale errors should be hidden until the user
      // submits again
      expect(
        screen.queryByText("Value must be a valid number")
      ).not.toBeInTheDocument();
      // Submitting the form should surface the (still-present) error
      const form = container.querySelector("form")!;
      fireEvent.submit(form);
      expect(
        screen.getByText("Value must be a valid number")
      ).toBeInTheDocument();
    });

    it("does not show stale errors when re-entering edit mode after a previous failure", () => {
      mockFetcherState = {
        state: "idle",
        data: { error: { message: "Old error" } },
      };
      renderField();
      // Initial display mode should not show errors (only during edit + after submit)
      expect(screen.queryByText("Old error")).not.toBeInTheDocument();
      // Enter edit mode
      fireEvent.click(screen.getByRole("button", { name: "Edit Description" }));
      // Stale error should NOT appear automatically
      expect(screen.queryByText("Old error")).not.toBeInTheDocument();
    });

    it("does not display the row when isEmpty and not editable, even if there is fetcher error data", () => {
      mockFetcherState = {
        state: "idle",
        data: { error: { message: "Some error" } },
      };
      const { container } = renderField({
        isEmpty: true,
        canEdit: false,
      });
      expect(container.querySelector("li")).not.toBeInTheDocument();
    });
  });
});
