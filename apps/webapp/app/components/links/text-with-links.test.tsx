/**
 * What a TEXT custom field value looks like on the asset page and the
 * advanced index: which characters become a link, where it points, and the
 * words a whole-link value's chip shows.
 *
 * @see {@link file://./text-with-links.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TextWithLinks } from "./text-with-links";

describe("TextWithLinks", () => {
  it("links only the URL inside text and keeps the words around it", () => {
    const { container } = render(
      <TextWithLinks value="Manual: https://example.com/a (rev B)" />
    );

    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("https://example.com/a");
    expect(link).toHaveAttribute(
      "href",
      "https://example.com/a?ref=shelf-webapp"
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(container).toHaveTextContent(
      "Manual: https://example.com/a (rev B)"
    );
  });

  it("links each URL when the text holds several", () => {
    render(
      <TextWithLinks value="EN https://example.com/en.pdf, DE https://example.com/de.pdf." />
    );

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href"))
    ).toEqual([
      "https://example.com/en.pdf?ref=shelf-webapp",
      "https://example.com/de.pdf?ref=shelf-webapp",
    ]);
  });

  it("shows a typed SharePoint link as a PDF chip named after the service", () => {
    render(
      <TextWithLinks value="https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?e=x1" />
    );

    const chip = screen.getByRole("link", { name: "PDF, SharePoint" });
    expect(chip).toHaveTextContent("PDFSharePoint");
    expect(chip).toHaveAttribute(
      "href",
      "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?e=x1&ref=shelf-webapp"
    );
    expect(chip).toHaveAttribute("target", "_blank");
    expect(chip).toHaveAttribute("rel", "noopener noreferrer");
    expect(chip).toHaveAttribute(
      "title",
      "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?e=x1"
    );
  });

  it("names the chip with a title the workspace knows for the link", () => {
    render(
      <TextWithLinks
        value="https://www.example.com/c/product/123"
        titles={{
          "https://www.example.com/c/product/123": {
            pageTitle: "Canon EOS R5",
            customTitle: null,
          },
        }}
      />
    );

    expect(
      screen.getByRole("link", { name: "Canon EOS R5, example.com" })
    ).toHaveTextContent("Canon EOS R5example.com");
  });

  it("leaves a javascript: value as plain text", () => {
    const { container } = render(<TextWithLinks value="javascript:alert(1)" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(container).toHaveTextContent("javascript:alert(1)");
  });
});
