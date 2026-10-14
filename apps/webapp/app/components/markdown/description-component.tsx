import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Button } from "~/components/shared/button";

/**
 * DescriptionComponent for Markdoc
 *
 * This component renders truncated descriptions that show full content
 * in a popover when clicked. Used for asset, booking and location description
 * changes in activity notes.
 *
 * A description gets a popover when it is longer than
 * {@link MAX_DISPLAY_LENGTH} characters or spans several lines. The inline
 * preview collapses every whitespace run to one space and ends in "..." when
 * it is cut short or the description has more lines; the popover shows the
 * full text with its line breaks.
 *
 * Usage in markdown content:
 * {% description oldText="long text..." newText="updated text..." /%}
 */

interface DescriptionComponentProps {
  oldText?: string;
  newText?: string;
}

const MAX_DISPLAY_LENGTH = 50;

const LINE_BREAK = /[\r\n]/;

/** Whether `text` is too long or too tall to show inline in full. */
function needsPopover(text: string): boolean {
  return text.length > MAX_DISPLAY_LENGTH || LINE_BREAK.test(text);
}

/**
 * The one-line inline preview of a description: whitespace runs collapsed,
 * cut at {@link MAX_DISPLAY_LENGTH}, and marked with "..." whenever the
 * reader does not see the whole text (truncated, or more lines follow).
 */
function previewText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length > MAX_DISPLAY_LENGTH) {
    return collapsed.substring(0, MAX_DISPLAY_LENGTH).trim() + "...";
  }
  return LINE_BREAK.test(text) ? collapsed + "..." : collapsed;
}

/**
 * A description shown in full: plain bold text when it fits inline,
 * otherwise a link-styled trigger with the preview that opens a popover
 * holding the full text, line breaks kept.
 *
 * @param props.text - The full description text
 * @param props.title - The popover heading, e.g. "Full Description:"
 */
function DescriptionPopover({ text, title }: { text: string; title: string }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!needsPopover(text)) {
    return <span className="font-semibold">{text}</span>;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 font-semibold text-black underline hover:text-primary"
          onClick={() => setIsOpen(!isOpen)}
        >
          {previewText(text)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[999999] w-80 rounded-md border bg-white p-3 shadow-lg"
        side="top"
        sideOffset={8}
      >
        <div className="text-sm">
          <div className="font-semibold text-gray-900">{title}</div>
          <div className="mt-1 whitespace-pre-line text-gray-700">{text}</div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Renders the `description` Markdoc tag: one description, or an old and a new
 * one joined by "to".
 *
 * @param props.oldText - The previous description, if any
 * @param props.newText - The new description, if any
 */
export function DescriptionComponent({
  oldText,
  newText,
}: DescriptionComponentProps) {
  // If only one text is provided, show single description
  if (oldText && !newText) {
    return <DescriptionPopover text={oldText} title="Full Description:" />;
  }

  if (newText && !oldText) {
    return <DescriptionPopover text={newText} title="Full Description:" />;
  }

  // Show both old and new descriptions (change scenario)
  if (oldText && newText) {
    return (
      <span>
        <DescriptionPopover text={oldText} title="Previous Description:" />
        <span> to </span>
        <DescriptionPopover text={newText} title="New Description:" />
      </span>
    );
  }

  // Fallback for edge cases
  return <span>Description updated</span>;
}
