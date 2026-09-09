/**
 * SelectWithOther — unit tests
 *
 * The onboarding form's required answers are captured by this control, so the
 * field has to stay answerable even when the page's JavaScript never runs.
 * These tests cover both halves of that contract:
 *  - the server render is a native <select> carrying the field's `name`
 *  - once hydrated, the styled popover takes over and writes the chosen value
 *
 * @see {@link file://./select-with-other.tsx}
 */

import { act, render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SelectWithOther } from "./select-with-other";

const OPTIONS = ["Operations Manager", "IT Administrator"] as const;

function renderOnServer(defaultValue?: string) {
  return renderToStaticMarkup(
    <SelectWithOther
      label="What's your role?"
      name="jobTitle"
      options={OPTIONS}
      required
      defaultValue={defaultValue}
      otherInputLabel="Specify your role"
    />
  );
}

describe("SelectWithOther without JavaScript", () => {
  it("server-renders a native select that carries the field name", () => {
    const html = renderOnServer();

    expect(html).toContain('<select id="jobTitle" name="jobTitle" required=""');
    // A hidden input would submit an empty answer and dead-end the form.
    expect(html).not.toContain('type="hidden"');
    // The popover trigger is inert without JS, so it must not be the server render.
    expect(html).not.toContain('aria-haspopup="dialog"');
  });

  it("offers every option plus the free-text escape hatch", () => {
    const html = renderOnServer();

    for (const option of OPTIONS) {
      expect(html).toContain(`<option value="${option}">${option}</option>`);
    }
    expect(html).toContain('<option value="Other">Other</option>');
  });

  it("preserves a previously saved free-text answer", () => {
    const html = renderOnServer("Head Groundskeeper");

    expect(html).toContain(
      '<option value="Head Groundskeeper" selected="">Head Groundskeeper</option>'
    );
  });

  it("preselects a saved preset answer", () => {
    const html = renderOnServer("IT Administrator");

    expect(html).toContain(
      '<option value="IT Administrator" selected="">IT Administrator</option>'
    );
  });
});

describe("SelectWithOther once hydrated", () => {
  it("swaps the native select for the styled control", () => {
    const { container, getByRole } = render(
      <SelectWithOther
        label="What's your role?"
        name="jobTitle"
        options={OPTIONS}
        required
        otherInputLabel="Specify your role"
      />
    );

    expect(container.querySelector("select")).toBeNull();
    expect(getByRole("button", { name: "What's your role?" })).toBeTruthy();
    // Exactly one control submits the value, whichever half is rendered.
    expect(container.querySelectorAll('[name="jobTitle"]')).toHaveLength(1);
  });

  it("keeps a saved answer selected", () => {
    const { container } = render(
      <SelectWithOther
        label="What's your role?"
        name="jobTitle"
        options={OPTIONS}
        required
        defaultValue="IT Administrator"
        otherInputLabel="Specify your role"
      />
    );

    expect(
      container.querySelector<HTMLInputElement>('input[name="jobTitle"]')?.value
    ).toBe("IT Administrator");
  });
});

describe("SelectWithOther during the hydration swap", () => {
  it("keeps an answer given before the bundle arrived", () => {
    const field = (
      <SelectWithOther
        label="What's your role?"
        name="jobTitle"
        options={OPTIONS}
        required
        otherInputLabel="Specify your role"
      />
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(field);

    // The user answers the server-rendered select while the bundle is loading.
    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    select!.value = "IT Administrator";

    let root: ReturnType<typeof hydrateRoot>;
    act(() => {
      root = hydrateRoot(container, field);
    });

    expect(
      container.querySelector<HTMLInputElement>('input[name="jobTitle"]')?.value
    ).toBe("IT Administrator");

    act(() => root.unmount());
    container.remove();
  });

  it("falls back to the saved value when the user answered nothing", () => {
    const field = (
      <SelectWithOther
        label="What's your role?"
        name="jobTitle"
        options={OPTIONS}
        required
        defaultValue="Operations Manager"
        otherInputLabel="Specify your role"
      />
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(field);

    let root: ReturnType<typeof hydrateRoot>;
    act(() => {
      root = hydrateRoot(container, field);
    });

    expect(
      container.querySelector<HTMLInputElement>('input[name="jobTitle"]')?.value
    ).toBe("Operations Manager");

    act(() => root.unmount());
    container.remove();
  });
});
