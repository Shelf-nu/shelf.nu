import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { MarkdownViewer } from "~/components/markdown/markdown-viewer";

import { PM_DOC_FIXTURE } from "../../fixtures/pm-doc-content";
import { ensurePmDocStyles } from "../../utils/inject-pm-doc-styles";

describe("MarkdownViewer", () => {
  beforeAll(() => {
    ensurePmDocStyles();
  });

  it("wraps rendered content with the shared pm-doc class", () => {
    const { container } = render(<MarkdownViewer content={PM_DOC_FIXTURE} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("pm-doc")).toBe(true);
    expect(wrapper.className.includes("prose")).toBe(false);
  });

  it("applies the pm-doc spacing rules in read-only mode", () => {
    const { container } = render(<MarkdownViewer content={PM_DOC_FIXTURE} />);

    const wrapper = container.firstElementChild as HTMLElement;
    const heading = wrapper.querySelector("h1") as HTMLElement;
    expect(heading).not.toBeNull();
    const paragraphAfterHeading = heading.nextElementSibling as HTMLElement;
    expect(paragraphAfterHeading).not.toBeNull();
    expect(getComputedStyle(paragraphAfterHeading).marginTop).toBe("12px");

    const h2 = wrapper.querySelector("h2") as HTMLElement;
    expect(h2).not.toBeNull();
    expect(getComputedStyle(h2).marginTop).toBe("20px");

    const list = wrapper.querySelector("ol") as HTMLOListElement;
    expect(list).not.toBeNull();
    expect(getComputedStyle(list).marginTop).toBe("20px");

    const secondListItem = wrapper.querySelector("ol li + li") as HTMLElement;
    expect(secondListItem).not.toBeNull();
    expect(getComputedStyle(secondListItem).marginTop).toBe("8px");

    const listParagraph = wrapper.querySelector("li p") as HTMLElement;
    expect(listParagraph).not.toBeNull();
    expect(getComputedStyle(listParagraph).marginTop).toBe("0px");

    const nestedList = wrapper.querySelector("li > p + ul") as HTMLElement;
    expect(nestedList).not.toBeNull();
    expect(getComputedStyle(nestedList).marginTop).toBe("8px");

    const blockquote = wrapper.querySelector("ol + blockquote") as HTMLElement;
    expect(blockquote).not.toBeNull();
    expect(getComputedStyle(blockquote).marginTop).toBe("20px");

    const rawBlock = wrapper.querySelector(".raw-block") as HTMLElement;
    expect(rawBlock).not.toBeNull();
    expect(getComputedStyle(rawBlock).marginTop).toBe("0px");

    const paragraphAfterRaw = wrapper.querySelector(
      ".raw-block + p"
    ) as HTMLElement;
    expect(paragraphAfterRaw).not.toBeNull();
    expect(getComputedStyle(paragraphAfterRaw).marginTop).toBe("20px");
  });
});
