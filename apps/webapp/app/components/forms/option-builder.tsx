import { useState } from "react";
import { CrossCircledIcon } from "@radix-ui/react-icons";

import { handleActivationKeyPress } from "~/utils/keyboard";
import Input from "./input";

interface Props {
  options: string[];
  onAdd: (input: string) => void;
  onRemove: (idx: number) => void;
  disabled?: boolean;
}

/** What pressing enter in the option builder should do with the typed text. */
export type OptionEntryResolution =
  | { status: "add"; option: string }
  | { status: "duplicate" }
  | { status: "ignore" };

/**
 * Decides whether typed text becomes an option, trimming it on the way in.
 *
 * Trimming belongs here rather than at save time: this is the only point that
 * sees an option before anything stores it. An option IS the string an asset
 * keeps in `AssetCustomFieldValue`, validated later by exact membership, so
 * rewriting one after the fact would orphan the assets pointing at it.
 *
 * Duplicates are compared on the trimmed text, because "Large" and " Large "
 * render as two rows an operator cannot tell apart.
 *
 * @param raw - The text currently in the input.
 * @param options - The options already added.
 * @returns Whether to add (with the text to add), report a duplicate, or do
 *   nothing at all.
 */
export function resolveOptionEntry(
  raw: string,
  options: string[]
): OptionEntryResolution {
  const option = raw.trim();

  if (!option) {
    return { status: "ignore" };
  }

  if (options.some((existing) => existing.trim() === option)) {
    return { status: "duplicate" };
  }

  return { status: "add", option };
}

function OptionBuilder({ options, onAdd, onRemove, disabled }: Props) {
  const [opt, setOpt] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="container flex-1 grow rounded border px-6 py-4 text-[14px] text-gray-600">
      <div className="">
        <Input
          onChange={({ target }) => setOpt(target.value)}
          label=""
          value={opt}
          placeholder="Type an option here and press enter"
          disabled={disabled}
          className="w-full"
          error={error}
          hideLabel
          onKeyDown={(e) => {
            if (e.key == "Enter") {
              e.preventDefault();
              const entry = resolveOptionEntry(opt, options);
              if (entry.status === "duplicate") {
                setError("Option already exists");
              } else if (entry.status === "add") {
                onAdd(entry.option);
                setOpt("");
                setError("");
              }
            }
          }}
        />
      </div>
      <div>
        {options.map((op, i) => (
          <div
            className="mt-2 flex items-center justify-between rounded border px-5 py-3 text-[14px] text-gray-600"
            key={op}
          >
            <span>{op}</span>
            <div
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={() => onRemove(i)}
              onKeyDown={handleActivationKeyPress(() => onRemove(i))}
            >
              <CrossCircledIcon className="size-6" />{" "}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default OptionBuilder;
