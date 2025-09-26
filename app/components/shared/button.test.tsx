import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

vi.mock("@remix-run/react", async () => {
  const actual = (await vi.importActual("@remix-run/react")) as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    Link: ({ to, children, ...rest }: any) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children}
      </a>
    ),
  };
});

describe("Button", () => {
  it("renders link variant as left-aligned text without button layout styles", () => {
    render(
      <Button variant="link" target="_blank" to="https://example.com">
        External link
      </Button>
    );

    const link = screen.getByRole("link", { name: "External link" });

    expect(link).not.toHaveClass("justify-center");
    expect(link).not.toHaveClass("box-shadow-xs");
    expect(link).not.toHaveClass("rounded");
    expect(link).not.toHaveClass("border");
    expect(link).toHaveClass("text-primary-700");
    expect(link.className).toMatch(/text-start|items-start|justify-start/);
  });
});
