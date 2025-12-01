import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InlineEntityCreationDialog from "./inline-entity-creation-dialog";

// why: Mock NewCategoryForm to avoid router dependencies and test dialog behavior in isolation
vi.mock("../category/new-category-form", () => ({
  default: ({ onSuccess }: any) => (
    <div data-testid="category-form">
      <label htmlFor="category-name">Name</label>
      <input id="category-name" />
      <label htmlFor="category-description">Description</label>
      <textarea id="category-description" />
      <button
        onClick={() =>
          onSuccess?.({
            category: {
              id: "cat-123",
              name: "Test Category",
              color: "#000000",
              description: "Test description",
            },
          })
        }
      >
        Save
      </button>
    </div>
  ),
}));

// why: Mock LocationForm to avoid router dependencies and test dialog behavior in isolation
vi.mock("../location/form", () => ({
  LocationForm: ({ onSuccess }: any) => (
    <div data-testid="location-form">
      <label htmlFor="location-name">Name</label>
      <input id="location-name" />
      <label htmlFor="location-description">Description</label>
      <textarea id="location-description" />
      <button
        onClick={() =>
          onSuccess?.({
            location: {
              id: "loc-456",
              name: "Test Location",
              thumbnailUrl: "https://example.com/thumb.jpg",
              imageUrl: "https://example.com/image.jpg",
            },
          })
        }
      >
        Save
      </button>
    </div>
  ),
}));

describe("InlineEntityCreationDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Button and Dialog visibility", () => {
    it("renders the trigger button with correct label", () => {
      render(
        <InlineEntityCreationDialog
          title="Create Category"
          buttonLabel="+ New Category"
          type="category"
        />
      );

      const button = screen.getByRole("button", { name: "+ New Category" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent("+ New Category");
    });

    it("opens dialog when trigger button is clicked", async () => {
      render(
        <InlineEntityCreationDialog
          title="Create Location"
          buttonLabel="+ New Location"
          type="location"
        />
      );

      const user = userEvent.setup();
      const triggerButton = screen.getByRole("button", {
        name: "+ New Location",
      });

      await act(async () => {
        await user.click(triggerButton);
      });

      await waitFor(() => {
        expect(screen.getByText("Create Location")).toBeInTheDocument();
      });
    });

    it("closes dialog when close button is clicked", async () => {
      render(
        <InlineEntityCreationDialog
          title="Create Category"
          buttonLabel="+ New Category"
          type="category"
        />
      );

      const user = userEvent.setup();
      // Open dialog
      await act(async () => {
        await user.click(
          screen.getByRole("button", { name: "+ New Category" })
        );
      });

      // Close dialog
      const closeButton = screen.getByLabelText("Close dialog");
      await act(async () => {
        await user.click(closeButton);
      });

      await waitFor(() => {
        expect(screen.queryByText("Create Category")).not.toBeInTheDocument();
      });
    });
  });

  describe("Category creation flow", () => {
    it("renders category form when type is category", async () => {
      render(
        <InlineEntityCreationDialog
          title="Create Category"
          buttonLabel="+ New Category"
          type="category"
        />
      );

      const user = userEvent.setup();
      await act(async () => {
        await user.click(
          screen.getByRole("button", { name: "+ New Category" })
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("category-form")).toBeInTheDocument();
      });
    });

    it("calls onCreated callback when category is successfully created", async () => {
      const onCreated = vi.fn();

      render(
        <InlineEntityCreationDialog
          title="Create Category"
          buttonLabel="+ New Category"
          type="category"
          onCreated={onCreated}
        />
      );

      const user = userEvent.setup();
      await act(async () => {
        await user.click(
          screen.getByRole("button", { name: "+ New Category" })
        );
      });

      // Click the save button in the mocked form
      await act(async () => {
        await user.click(screen.getByRole("button", { name: "Save" }));
      });

      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledWith({
          type: "category",
          entity: {
            id: "cat-123",
            name: "Test Category",
            color: "#000000",
            description: "Test description",
          },
        });
      });
    });
  });

  describe("Location creation flow", () => {
    it("renders location form when type is location", async () => {
      render(
        <InlineEntityCreationDialog
          title="Create Location"
          buttonLabel="+ New Location"
          type="location"
        />
      );

      const user = userEvent.setup();
      await act(async () => {
        await user.click(
          screen.getByRole("button", { name: "+ New Location" })
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("location-form")).toBeInTheDocument();
      });
    });

    it("calls onCreated callback when location is successfully created", async () => {
      const onCreated = vi.fn();

      render(
        <InlineEntityCreationDialog
          title="Create Location"
          buttonLabel="+ New Location"
          type="location"
          onCreated={onCreated}
        />
      );

      const user = userEvent.setup();
      await act(async () => {
        await user.click(
          screen.getByRole("button", { name: "+ New Location" })
        );
      });

      // Click the save button in the mocked form
      await act(async () => {
        await user.click(screen.getByRole("button", { name: "Save" }));
      });

      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledWith({
          type: "location",
          entity: {
            id: "loc-456",
            name: "Test Location",
            thumbnailUrl: "https://example.com/thumb.jpg",
            imageUrl: "https://example.com/image.jpg",
          },
        });
      });
    });
  });

  describe("Accessibility", () => {
    it("has accessible button label", () => {
      render(
        <InlineEntityCreationDialog
          title="Create Category"
          buttonLabel="+ New Category"
          type="category"
        />
      );

      const button = screen.getByRole("button", { name: "+ New Category" });
      expect(button).toHaveAccessibleName();
    });

    it("has accessible dialog role and label", async () => {
      render(
        <InlineEntityCreationDialog
          title="Create Location"
          buttonLabel="+ New Location"
          type="location"
        />
      );

      const user = userEvent.setup();
      await act(async () => {
        await user.click(
          screen.getByRole("button", { name: "+ New Location" })
        );
      });

      await waitFor(() => {
        const dialog = screen.getByRole("dialog");
        expect(dialog).toBeInTheDocument();
      });
    });
  });
});
