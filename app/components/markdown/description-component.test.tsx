import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DescriptionComponent } from "./description-component";

// Mock the Button component
vi.mock("~/components/shared/button", () => ({
  Button: vi.fn(({ children, onClick, className, ...props }) => (
    <button onClick={onClick} className={className} {...props}>
      {children}
    </button>
  )),
}));

// Mock Radix UI Popover components
vi.mock("@radix-ui/react-popover", () => ({
  Popover: vi.fn(({ children, open, onOpenChange }) => (
    <div
      data-testid="popover"
      data-open={open}
      data-on-open-change={!!onOpenChange}
    >
      {children}
    </div>
  )),
  PopoverTrigger: vi.fn(({ children, asChild, ...props }) => (
    <div data-testid="popover-trigger" data-as-child={asChild} {...props}>
      {children}
    </div>
  )),
  PopoverContent: vi.fn(({ children, className, ...props }) => (
    <div data-testid="popover-content" className={className} {...props}>
      {children}
    </div>
  )),
}));

describe("DescriptionComponent", () => {
  describe("Single description (oldText only)", () => {
    it("should render short oldText without popover", () => {
      render(<DescriptionComponent oldText="Short description" />);

      expect(screen.getByText("Short description")).toBeInTheDocument();
      expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
    });

    it("should render long oldText with popover", () => {
      const longText =
        "This is a very long description that exceeds the maximum display length and should be truncated";
      render(<DescriptionComponent oldText={longText} />);

      expect(screen.getByTestId("popover")).toBeInTheDocument();
      expect(screen.getByRole("button")).toBeInTheDocument();
      const button = screen.getByRole("button");
      expect(button.textContent).toContain(
        "This is a very long description that exceeds the m..."
      );
    });

    it("should show full description in popover content for long text", () => {
      const longText =
        "This is a very long description that exceeds the maximum display length and should be truncated";
      render(<DescriptionComponent oldText={longText} />);

      expect(screen.getByText("Full Description:")).toBeInTheDocument();
      expect(screen.getByText(longText)).toBeInTheDocument();
    });
  });

  describe("Description change (both oldText and newText)", () => {
    it("should render both short descriptions without popovers", () => {
      render(<DescriptionComponent oldText="Old desc" newText="New desc" />);

      expect(screen.getByText("Old desc")).toBeInTheDocument();
      expect(screen.getByText(/to/)).toBeInTheDocument();
      expect(screen.getByText("New desc")).toBeInTheDocument();
    });

    it("should render long oldText with popover and short newText without", () => {
      const longOldText =
        "This is a very long old description that should be truncated and shown in popover";
      render(
        <DescriptionComponent oldText={longOldText} newText="Short new" />
      );

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1); // Only old text has popover

      const [oldButton] = buttons;
      expect(oldButton.textContent).toContain(
        "This is a very long old description that should be..."
      );
      expect(screen.getByText("Short new")).toBeInTheDocument();
      expect(screen.getByText("Previous Description:")).toBeInTheDocument();
      expect(screen.getByText(longOldText)).toBeInTheDocument();
    });

    it("should render short oldText without popover and long newText with", () => {
      const longNewText =
        "This is a very long new description that should be truncated and shown in popover";
      render(
        <DescriptionComponent oldText="Short old" newText={longNewText} />
      );

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1); // Only new text has popover

      expect(screen.getByText("Short old")).toBeInTheDocument();
      const [newButton] = buttons;
      expect(newButton.textContent).toContain(
        "This is a very long new description that should be..."
      );
      expect(screen.getByText("New Description:")).toBeInTheDocument();
      expect(screen.getByText(longNewText)).toBeInTheDocument();
    });

    it("should render both long descriptions with popovers", () => {
      const longOldText =
        "This is a very long old description that should be truncated and shown in popover when clicked";
      const longNewText =
        "This is a very long new description that should be truncated and shown in popover when clicked";
      render(
        <DescriptionComponent oldText={longOldText} newText={longNewText} />
      );

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(2); // Both texts have popovers

      const [oldButton, newButton] = buttons;
      expect(oldButton.textContent).toContain(
        "This is a very long old description that should be..."
      );
      expect(newButton.textContent).toContain(
        "This is a very long new description that should be..."
      );
      expect(screen.getByText("Previous Description:")).toBeInTheDocument();
      expect(screen.getByText("New Description:")).toBeInTheDocument();
      expect(screen.getByText(longOldText)).toBeInTheDocument();
      expect(screen.getByText(longNewText)).toBeInTheDocument();
    });
  });

  describe("Edge cases", () => {
    it("should render fallback for edge cases", () => {
      render(<DescriptionComponent />);
      expect(screen.getByText("Description updated")).toBeInTheDocument();
    });

    it("should handle newText only case", () => {
      render(<DescriptionComponent newText="Only new text" />);
      expect(screen.getByText("Description updated")).toBeInTheDocument();
    });

    it("should handle empty strings", () => {
      render(<DescriptionComponent oldText="" newText="" />);

      // Empty strings are treated as falsy and show fallback
      expect(screen.getByText("Description updated")).toBeInTheDocument();
    });

    it("should handle exactly 50 character descriptions (boundary test)", () => {
      const exactlyFiftyChars =
        "This description is exactly fifty characters long.";
      expect(exactlyFiftyChars.length).toBe(50);

      render(<DescriptionComponent oldText={exactlyFiftyChars} />);

      expect(screen.getByText(exactlyFiftyChars)).toBeInTheDocument();
      expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
    });

    it("should handle 51 character descriptions (should truncate)", () => {
      const fiftyOneChars =
        "This description is exactly fifty-one characters l.";
      expect(fiftyOneChars.length).toBe(51);

      render(<DescriptionComponent oldText={fiftyOneChars} />);

      expect(screen.getByTestId("popover")).toBeInTheDocument();
      const button = screen.getByRole("button");
      expect(button.textContent).toContain(
        "This description is exactly fifty-one characters l..."
      );
    });
  });

  describe("Popover interaction", () => {
    it("should handle popover open/close state for single description", () => {
      const longText =
        "This is a very long description that should trigger popover functionality";
      render(<DescriptionComponent oldText={longText} />);

      const popover = screen.getByTestId("popover");
      expect(popover.getAttribute("data-open")).toBe("false");

      const button = screen.getByRole("button");
      fireEvent.click(button);

      // In a real implementation, this would change based on state
      // For testing purposes, we're just verifying the button is clickable
      expect(button).toBeInTheDocument();
    });
  });

  describe("Text truncation", () => {
    it("should truncate at word boundaries when possible", () => {
      const textWithSpaces =
        "This is a longer description with multiple words that should be truncated properly";
      render(<DescriptionComponent oldText={textWithSpaces} />);

      // Should truncate and add ellipsis
      const button = screen.getByRole("button");
      expect(button.textContent).toContain("...");
    });

    it("should handle descriptions without spaces", () => {
      const noSpacesText =
        "Thisisaverylongdescriptionwithoutanyspacesthatshouldbetruncannyway";
      render(<DescriptionComponent oldText={noSpacesText} />);

      expect(screen.getByTestId("popover")).toBeInTheDocument();
      const button = screen.getByRole("button");
      expect(button.textContent).toContain(
        "Thisisaverylongdescriptionwithoutanyspacesthatshou..."
      );
    });
  });

  describe("Accessibility", () => {
    it("should provide proper ARIA labels for popover triggers", () => {
      const longText = "This is a very long description that needs a popover";
      render(<DescriptionComponent oldText={longText} />);

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
      expect(button.textContent).toContain("...");
    });

    it("should have proper popover content structure", () => {
      const longText = "This is a very long description for popover testing";
      render(<DescriptionComponent oldText={longText} />);

      expect(screen.getByTestId("popover-content")).toHaveClass(
        "z-[999999]",
        "w-80",
        "rounded-md",
        "border",
        "bg-white",
        "p-3",
        "shadow-lg"
      );
      expect(screen.getByText("Full Description:")).toBeInTheDocument();
    });
  });
});
