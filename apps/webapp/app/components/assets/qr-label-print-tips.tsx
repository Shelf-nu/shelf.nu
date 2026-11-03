/**
 * QrLabelPrintTips — the "before you print" checklist, folded away behind one
 * line so the label preview keeps the space. Shared by the sheet and the
 * label-printer journeys; each passes its own bullets.
 *
 * @see {@link file://./qr-label-sheet.tsx}
 * @see {@link file://./qr-label-stock-sheet.tsx}
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/shared/collapsible";
import { tw } from "~/utils/tw";

/**
 * @param props.items - the bullets to show when expanded
 * @param props.label - the trigger text (default "Before you print")
 */
export function QrLabelPrintTips({
  items,
  label = "Before you print",
}: {
  items: ReactNode[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="px-1 pt-1">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900"
        >
          {label}
          <ChevronDown
            className={tw(
              "size-3.5 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-gray-500">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
