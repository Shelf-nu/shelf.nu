/**
 * The "Name this link" control: what it posts to /api/link-titles and how it
 * answers that route's response.
 *
 * The stubbed route answers with `LINK_TITLE_SAVED`, the body the route's own
 * test pins, and with the standard error shape, so a change to either side of
 * the response breaks one of the two tests.
 *
 * @see {@link file://./rename-link-popover.tsx}
 * @see {@link file://../../../test/routes-tests/api+/link-titles.test.ts}
 */
import { parseLink, type LinkTitle } from "@shelf/links";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, data } from "react-router";
import { describe, expect, it } from "vitest";
import {
  LINK_TITLE_SAVED,
  LINK_TITLES,
  MANUAL_URL,
} from "@helpers/link-titles";

import { RenameLinkPopover } from "./rename-link-popover";

/**
 * Renders the control for a stored value (`MANUAL_URL` unless given) beside a
 * stubbed /api/link-titles that answers with `answer()`.
 *
 * @returns The forms the route received, as plain objects
 */
function renderPopover(
  answer: () => unknown,
  title: LinkTitle | undefined = LINK_TITLES[MANUAL_URL],
  value = MANUAL_URL
) {
  const posted: Record<string, FormDataEntryValue>[] = [];
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <RenameLinkPopover
          value={value}
          link={parseLink(value)!}
          title={title}
        />
      ),
    },
    {
      path: "/api/link-titles",
      action: async ({ request }) => {
        posted.push(Object.fromEntries(await request.formData()));
        return answer();
      },
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  return posted;
}

describe("RenameLinkPopover", () => {
  it("saves the typed name for the link, then closes and hands focus back", async () => {
    const user = userEvent.setup();
    const posted = renderPopover(() => LINK_TITLE_SAVED);

    const trigger = await screen.findByRole("button", {
      name: "Name this link",
    });
    await user.click(trigger);

    expect(
      screen.getByRole("dialog", { name: "Name this link" })
    ).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Link name" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("");
    // Blank, the chip reads the page title.
    expect(field).toHaveAttribute("placeholder", "EOS R5 user manual");
    expect(field).toHaveAccessibleDescription(
      "Shown everywhere this link appears in your workspace."
    );
    expect(screen.queryByRole("button", { name: "Remove name" })).toBeNull();

    await user.type(field, "Camera manual");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posted).toEqual([{ url: MANUAL_URL, title: "Camera manual" }]);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows the server's refusal under the field and stays open", async () => {
    const user = userEvent.setup();
    renderPopover(() =>
      data(
        { error: { message: "Only a web link can be named." } },
        { status: 400 }
      )
    );

    await user.click(
      await screen.findByRole("button", { name: "Name this link" })
    );
    await user.type(screen.getByRole("textbox"), "Camera manual");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only a web link can be named."
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("clears a name someone gave the link with Remove name", async () => {
    const user = userEvent.setup();
    const posted = renderPopover(() => LINK_TITLE_SAVED, {
      pageTitle: "EOS R5 user manual",
      customTitle: "Camera manual",
    });

    await user.click(
      await screen.findByRole("button", { name: "Name this link" })
    );
    expect(screen.getByRole("textbox")).toHaveValue("Camera manual");
    await user.click(screen.getByRole("button", { name: "Remove name" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posted).toEqual([{ url: MANUAL_URL, title: "" }]);
  });

  it("posts the value as stored, spaces around the link included", async () => {
    const user = userEvent.setup();
    // The route names only a value some asset stores exactly.
    const stored = `  ${MANUAL_URL} `;
    const posted = renderPopover(() => LINK_TITLE_SAVED, undefined, stored);

    await user.click(
      await screen.findByRole("button", { name: "Name this link" })
    );
    await user.type(screen.getByRole("textbox"), "Camera manual");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posted).toEqual([{ url: stored, title: "Camera manual" }]);
  });
});
