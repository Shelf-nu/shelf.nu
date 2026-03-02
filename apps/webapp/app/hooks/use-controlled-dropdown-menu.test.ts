import { renderHook, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useControlledDropdownMenu } from "./use-controlled-dropdown-menu";

const mockSearchParams = vi.hoisted(() => new URLSearchParams());

// why: control search params to test QR scan detection without actual routing
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [mockSearchParams] as const,
}));

describe("useControlledDropdownMenu", () => {
  beforeEach(() => {
    mockSearchParams.set("ref", "");
    vi.stubGlobal("innerWidth", 1024);
  });

  describe("QR code scanning on mobile", () => {
    it("auto-opens menu when user scans QR code on mobile device", async () => {
      // User on mobile device (640px or less)
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.set("ref", "qr");

      const { result } = renderHook(() => useControlledDropdownMenu());

      // Menu should auto-open
      await waitFor(() => {
        expect(result.current.open).toBe(true);
      });

      expect(result.current.defaultApplied).toBe(true);
    });

    it("does not auto-open menu when user scans QR code on desktop", () => {
      // User on desktop device (>640px)
      vi.stubGlobal("innerWidth", 1024);
      mockSearchParams.set("ref", "qr");

      const { result } = renderHook(() => useControlledDropdownMenu());

      // Menu should NOT auto-open on desktop
      expect(result.current.open).toBe(false);
      expect(result.current.defaultApplied).toBe(false);
    });

    it("does not auto-open when skipDefault option is enabled", () => {
      // Even on mobile with QR scan
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.set("ref", "qr");

      const { result } = renderHook(() =>
        useControlledDropdownMenu({ skipDefault: true })
      );

      // Menu should NOT auto-open when skipDefault is true
      expect(result.current.open).toBe(false);
    });
  });

  describe("normal page visits (no QR scan)", () => {
    it("keeps menu closed when visiting page normally on mobile", () => {
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.delete("ref");

      const { result } = renderHook(() => useControlledDropdownMenu());

      expect(result.current.open).toBe(false);
    });

    it("keeps menu closed when visiting page normally on desktop", () => {
      vi.stubGlobal("innerWidth", 1024);
      mockSearchParams.delete("ref");

      const { result } = renderHook(() => useControlledDropdownMenu());

      expect(result.current.open).toBe(false);
    });

    it("keeps menu closed when ref param is not QR scan", () => {
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.set("ref", "other-source");

      const { result } = renderHook(() => useControlledDropdownMenu());

      expect(result.current.open).toBe(false);
    });
  });

  describe("user closes dropdown by clicking outside", () => {
    it("closes menu when user clicks outside dropdown area", async () => {
      // Setup: menu is open on mobile QR scan
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.set("ref", "qr");

      const { result } = renderHook(() => useControlledDropdownMenu());

      // Wait for auto-open
      await waitFor(() => {
        expect(result.current.open).toBe(true);
      });

      // Attach ref to a mock element
      const mockElement = document.createElement("div");
      document.body.appendChild(mockElement);
      (result.current.ref as any).current = mockElement;

      // User clicks outside the dropdown
      const outsideElement = document.createElement("div");
      document.body.appendChild(outsideElement);
      fireEvent.mouseDown(outsideElement);

      // Menu should close
      await waitFor(() => {
        expect(result.current.open).toBe(false);
      });

      // Cleanup
      document.body.removeChild(mockElement);
      document.body.removeChild(outsideElement);
    });

    it("keeps menu open when user clicks inside dropdown", async () => {
      // Setup: menu is open
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.set("ref", "qr");

      const { result } = renderHook(() => useControlledDropdownMenu());

      await waitFor(() => {
        expect(result.current.open).toBe(true);
      });

      // Attach ref to a mock element
      const mockElement = document.createElement("div");
      document.body.appendChild(mockElement);
      (result.current.ref as any).current = mockElement;

      // User clicks inside the dropdown
      fireEvent.mouseDown(mockElement);

      // Menu should stay open
      expect(result.current.open).toBe(true);

      // Cleanup
      document.body.removeChild(mockElement);
    });

    it("keeps menu open when user clicks on alert dialog", async () => {
      // Setup: menu is open
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.set("ref", "qr");

      const { result } = renderHook(() => useControlledDropdownMenu());

      await waitFor(() => {
        expect(result.current.open).toBe(true);
      });

      // Attach ref to a mock element
      const mockElement = document.createElement("div");
      document.body.appendChild(mockElement);
      (result.current.ref as any).current = mockElement;

      // Create alert dialog
      const alertDialog = document.createElement("div");
      alertDialog.setAttribute("role", "alertdialog");
      document.body.appendChild(alertDialog);

      // User clicks on alert dialog
      fireEvent.mouseDown(alertDialog);

      // Menu should stay open (alert dialogs are part of the flow)
      expect(result.current.open).toBe(true);

      // Cleanup
      document.body.removeChild(mockElement);
      document.body.removeChild(alertDialog);
    });
  });

  describe("user manually controls menu", () => {
    it("allows user to manually open the menu", () => {
      const { result } = renderHook(() => useControlledDropdownMenu());

      expect(result.current.open).toBe(false);

      // User manually opens menu
      act(() => {
        result.current.setOpen(true);
      });

      expect(result.current.open).toBe(true);
    });

    it("allows user to manually close the menu", async () => {
      // Start with auto-opened menu
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.set("ref", "qr");

      const { result } = renderHook(() => useControlledDropdownMenu());

      await waitFor(() => {
        expect(result.current.open).toBe(true);
      });

      // User manually closes menu
      act(() => {
        result.current.setOpen(false);
      });

      expect(result.current.open).toBe(false);
    });

    it("allows user to toggle menu multiple times", () => {
      const { result } = renderHook(() => useControlledDropdownMenu());

      // Open
      act(() => {
        result.current.setOpen(true);
      });
      expect(result.current.open).toBe(true);

      // Close
      act(() => {
        result.current.setOpen(false);
      });
      expect(result.current.open).toBe(false);

      // Open again
      act(() => {
        result.current.setOpen(true);
      });
      expect(result.current.open).toBe(true);
    });
  });

  describe("auto-open behavior", () => {
    it("only auto-opens once even if conditions remain true", async () => {
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.set("ref", "qr");

      const { result, rerender } = renderHook(() =>
        useControlledDropdownMenu()
      );

      // Wait for auto-open
      await waitFor(() => {
        expect(result.current.open).toBe(true);
      });

      // User closes the menu
      act(() => {
        result.current.setOpen(false);
      });

      // Re-render (simulating component update)
      rerender();

      // Menu should NOT auto-open again
      expect(result.current.open).toBe(false);
      expect(result.current.defaultApplied).toBe(true);
    });

    it("provides correct defaultOpen value based on conditions", () => {
      vi.stubGlobal("innerWidth", 640);
      mockSearchParams.set("ref", "qr");

      const { result } = renderHook(() => useControlledDropdownMenu());

      expect(result.current.defaultOpen).toBe(true);
    });

    it("provides correct defaultOpen value when conditions not met", () => {
      vi.stubGlobal("innerWidth", 1024);
      mockSearchParams.set("ref", "qr");

      const { result } = renderHook(() => useControlledDropdownMenu());

      expect(result.current.defaultOpen).toBe(false);
    });
  });
});
