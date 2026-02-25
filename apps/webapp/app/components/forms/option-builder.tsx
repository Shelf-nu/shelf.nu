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
              if (opt) {
                if (options.includes(opt)) {
                  setError("Option already exists");
                } else {
                  onAdd(opt);
                  setOpt("");
                  setError("");
                }
              }
            }
          }}
        />
      </div>
      <div>
        {options.map((op, i) => (
          <div
            className="mt-2 flex items-center justify-between rounded border px-5 py-3 text-[14px] text-gray-600"
            key={`${i}${op}`}
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
