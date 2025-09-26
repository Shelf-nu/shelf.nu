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
 * in a popover when clicked. Used for booking description changes in activity notes.
 *
 * Usage in markdown content:
 * {% description oldText="long text..." newText="updated text..." /%}
 */

interface DescriptionComponentProps {
  oldText?: string;
  newText?: string;
}

const MAX_DISPLAY_LENGTH = 50;

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + "...";
}

export function DescriptionComponent({
  oldText,
  newText,
}: DescriptionComponentProps) {
  const [isOpen, setIsOpen] = useState(false);

  // If only one text is provided, show single description
  if (oldText && !newText) {
    const isLong = oldText.length > MAX_DISPLAY_LENGTH;
    if (!isLong) {
      return <span className="font-semibold">{oldText}</span>;
    }

    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="link"
            className="h-auto p-0 font-semibold text-black underline hover:text-primary"
            onClick={() => setIsOpen(!isOpen)}
          >
            {truncateText(oldText, MAX_DISPLAY_LENGTH)}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="z-[999999] w-80 rounded-md border bg-white p-3 shadow-lg"
          side="top"
          sideOffset={8}
        >
          <div className="text-sm">
            <div className="font-semibold text-gray-900">Full Description:</div>
            <div className="mt-1 text-gray-700">{oldText}</div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Show both old and new descriptions (change scenario)
  if (oldText && newText) {
    const oldIsLong = oldText.length > MAX_DISPLAY_LENGTH;
    const newIsLong = newText.length > MAX_DISPLAY_LENGTH;

    return (
      <span>
        {/* Old description */}
        {oldIsLong ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="link"
                className="h-auto p-0 font-semibold text-black underline hover:text-primary"
              >
                {truncateText(oldText, MAX_DISPLAY_LENGTH)}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="z-[999999] w-80 rounded-md border bg-white p-3 shadow-lg"
              side="top"
              sideOffset={8}
            >
              <div className="text-sm">
                <div className="font-semibold text-gray-900">
                  Previous Description:
                </div>
                <div className="mt-1 text-gray-700">{oldText}</div>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="font-semibold">{oldText}</span>
        )}

        <span> to </span>

        {/* New description */}
        {newIsLong ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="link"
                className="h-auto p-0 font-semibold text-black underline hover:text-primary"
              >
                {truncateText(newText, MAX_DISPLAY_LENGTH)}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="z-[999999] w-80 rounded-md border bg-white p-3 shadow-lg"
              side="top"
              sideOffset={8}
            >
              <div className="text-sm">
                <div className="font-semibold text-gray-900">
                  New Description:
                </div>
                <div className="mt-1 text-gray-700">{newText}</div>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="font-semibold">{newText}</span>
        )}
      </span>
    );
  }

  // Fallback for edge cases
  return <span>Description updated</span>;
}
