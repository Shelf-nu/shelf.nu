import clsx from "clsx";

interface TextDiffComponentProps {
  label?: string;
  previous?: string;
  new?: string;
}

/**
 * TextDiffComponent for Markdoc activity notes.
 *
 * Renders a compact before/after view for text changes, highlighting the
 * previous value in red and the new value in green. When only one side is
 * provided, renders the available value in its corresponding style.
 */
export function TextDiffComponent({
  label,
  previous,
  new: next,
}: TextDiffComponentProps) {
  const hasPrevious = typeof previous === "string" && previous.length > 0;
  const hasNew = typeof next === "string" && next.length > 0;

  if (!hasPrevious && !hasNew) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 text-sm text-gray-900">
      {label ? (
        <span className="font-semibold text-gray-700">{label}</span>
      ) : null}

      {hasPrevious ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          <span className="font-medium uppercase tracking-wide text-red-600">
            Previous
          </span>
          <p className={clsx("mt-1 break-words", hasNew && "line-through")}>{previous}</p>
        </div>
      ) : null}

      {hasNew ? (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-900">
          <span className="font-medium uppercase tracking-wide text-emerald-600">
            New
          </span>
          <p className="mt-1 break-words font-semibold">{next}</p>
        </div>
      ) : null}
    </div>
  );
}
