import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFetcher } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickAdjustDialog } from "~/components/assets/quick-adjust-dialog";

// why: providing stable Remix hooks for rendering QuickAdjustDialog in isolation
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useFetcher: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
  };
});

const useFetcherMock = vi.mocked(useFetcher);

describe("QuickAdjustDialog", () => {
  const submitMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useFetcherMock.mockReturnValue({
      Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
      state: "idle",
      data: null,
      formData: null,
      submit: submitMock,
    } as any);
  });

  it("renders adjust by amount by default and shows tabs when totalQuantity is provided", () => {
    render(
      <QuickAdjustDialog
        assetId="asset-1"
        totalQuantity={10}
        availableQuantity={5}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText("Adjust by amount")).toBeInTheDocument();
    expect(screen.getByText("Set new total")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Quantity \(/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/New Total/)).not.toBeInTheDocument();
  });

  it("switches to set new total tab when clicked", async () => {
    const user = userEvent.setup();
    render(
      <QuickAdjustDialog
        assetId="asset-1"
        totalQuantity={10}
        availableQuantity={5}
        open={true}
        onOpenChange={() => {}}
      />
    );

    await user.click(screen.getByText("Set new total"));

    expect(screen.getByText("Current total:")).toBeInTheDocument();
    expect(screen.getByText("10 units")).toBeInTheDocument();
    expect(screen.getByLabelText(/New Total Quantity/)).toBeInTheDocument();
  });

  it("submits the correct restock delta when setting a larger total", async () => {
    const user = userEvent.setup();
    render(
      <QuickAdjustDialog
        assetId="asset-1"
        totalQuantity={10}
        availableQuantity={5}
        open={true}
        onOpenChange={() => {}}
      />
    );

    await user.click(screen.getByText("Set new total"));
    const input = screen.getByPlaceholderText("Enter new total quantity");
    await user.type(input, "15");
    await user.click(screen.getByText("Set Total"));

    expect(submitMock).toHaveBeenCalled();
    const submittedData = submitMock.mock.calls[0][0];
    expect(submittedData.get("quantity")).toBe("5");
    expect(submittedData.get("direction")).toBe("add");
    expect(submittedData.get("category")).toBe("RESTOCK");
  });

  it("submits the correct loss delta when setting a smaller total", async () => {
    const user = userEvent.setup();
    render(
      <QuickAdjustDialog
        assetId="asset-1"
        totalQuantity={10}
        availableQuantity={5}
        open={true}
        onOpenChange={() => {}}
      />
    );

    await user.click(screen.getByText("Set new total"));
    const input = screen.getByPlaceholderText("Enter new total quantity");
    await user.type(input, "8");
    await user.click(screen.getByText("Set Total"));

    expect(submitMock).toHaveBeenCalled();
    const submittedData = submitMock.mock.calls[0][0];
    expect(submittedData.get("quantity")).toBe("2");
    expect(submittedData.get("direction")).toBe("subtract");
    expect(submittedData.get("category")).toBe("LOSS");
  });

  it("fails validation if trying to reduce total by more than available quantity", async () => {
    const user = userEvent.setup();
    render(
      <QuickAdjustDialog
        assetId="asset-1"
        totalQuantity={10}
        availableQuantity={5}
        open={true}
        onOpenChange={() => {}}
      />
    );

    await user.click(screen.getByText("Set new total"));
    const input = screen.getByPlaceholderText("Enter new total quantity");
    await user.type(input, "3"); // diff is 7, but available is 5
    await user.click(screen.getByText("Set Total"));

    expect(submitMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Cannot reduce total to 3/)).toBeInTheDocument();
  });
});
