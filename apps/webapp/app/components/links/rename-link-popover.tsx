/**
 * The control beside a link chip that names the link for the whole
 * workspace.
 *
 * Posts `url` (the value as stored) and `title` to /api/link-titles. The name
 * belongs to the workspace's link, not to one asset, so every chip showing the
 * same link reads it once the page revalidates. A blank name, or "Remove
 * name", clears it and the chip falls back to the page title or the words the
 * URL gives.
 *
 * @see {@link file://../../routes/api+/link-titles.ts}
 * @see {@link file://./text-with-links.tsx} which places it beside the chip
 */
import { useEffect, useId, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { linkChipText, type LinkTitle, type ParsedLink } from "@shelf/links";
import { TagIcon } from "lucide-react";
import { useFetcher } from "react-router";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { useFetcherOutcomeSinceOpen } from "~/hooks/use-fetcher-error-since-open";

const LINK_TITLES_ACTION = "/api/link-titles";

/**
 * A "Name this link" button that opens a small form in a popover.
 *
 * Closes on a saved name and returns focus to the button; a refusal stays
 * open with the server's message under the field.
 *
 * @param props.value - The custom field value as stored; the server names
 *   only a link some asset of the workspace stores
 * @param props.link - The parsed value the chip shows
 * @param props.title - What the workspace knows about the link, if anything
 */
export function RenameLinkPopover({
  value,
  link,
  title,
}: {
  value: string;
  link: ParsedLink;
  title?: LinkTitle;
}) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher();
  const disabled = useDisabled(fetcher);
  const outcome = useFetcherOutcomeSinceOpen(fetcher, open);
  const headingId = useId();
  const hintId = useId();
  const errorId = useId();

  useEffect(() => {
    if (outcome.status === "accepted") setOpen(false);
  }, [outcome.status]);

  const customTitle = title?.customTitle ?? null;
  /** What the chip reads once the name is cleared. */
  const unnamed = linkChipText(link, {
    pageTitle: title?.pageTitle ?? null,
    customTitle: null,
  }).primary;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Name this link"
          title="Name this link"
          className="inline-flex shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <TagIcon className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          sideOffset={4}
          aria-labelledby={headingId}
          className="z-[999999] w-72 rounded-md border border-gray-200 bg-white p-4 shadow-lg"
        >
          <fetcher.Form method="post" action={LINK_TITLES_ACTION}>
            <input type="hidden" name="url" value={value} />
            <h3 id={headingId} className="text-sm font-semibold text-gray-900">
              Name this link
            </h3>
            <Input
              label="Link name"
              hideLabel
              name="title"
              defaultValue={customTitle ?? ""}
              placeholder={unnamed}
              autoComplete="off"
              aria-describedby={
                outcome.message ? `${hintId} ${errorId}` : hintId
              }
              error={outcome.message ?? undefined}
              hideErrorText
              className="mt-2"
            />
            <p id={hintId} className="mt-1 text-xs text-gray-500">
              Shown everywhere this link appears in your workspace.
            </p>
            {outcome.message ? (
              <p
                id={errorId}
                role="alert"
                className="mt-1 text-sm text-error-500"
              >
                {outcome.message}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              {customTitle ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() =>
                    void fetcher.submit(
                      { url: value, title: "" },
                      { method: "post", action: LINK_TITLES_ACTION }
                    )
                  }
                >
                  Remove name
                </Button>
              ) : null}
              <Button type="submit" variant="primary" disabled={disabled}>
                {disabled ? "Saving..." : "Save"}
              </Button>
            </div>
          </fetcher.Form>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
