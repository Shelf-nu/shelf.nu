import { useState } from "react";
import { CrossCircledIcon } from "@radix-ui/react-icons";

import Input from "./input";

interface Props {
  options: String[];
  onAdd: (input: string) => void;
  onRemove: (idx: number) => void;
  disabled?: boolean;
}

function OptionBuilder({ options, onAdd, onRemove, disabled }: Props) {
  const [opt, setOpt] = useState("");
  return (
    <div className="container flex-1 grow rounded-xl border px-6 py-5 text-[14px] text-gray-600">
      <div className="">
        <Input
          onChange={({ target }) => setOpt(target.value)}
          label=""
          value={opt}
          defaultValue={opt}
          placeholder="Type an option here and press enter"
          disabled={disabled}
          className="w-full"
          hideLabel
          onKeyDown={(e) => {
            if (e.key == "Enter") {
              e.preventDefault();
              if (opt) {
                onAdd(opt);
                setOpt("");
              }
            }
          }}
        />
      </div>
      <div>
        {options.map((op, i) => (
          <div
            className="mt-2 flex justify-between rounded-xl border px-5 py-3 text-[14px] text-gray-600"
            key={`${i}${op}`}
          >
            <span>{op}</span>
            <div className="cursor-pointer" onClick={() => onRemove(i)}>
              <CrossCircledIcon className="h-6 w-6" />{" "}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default OptionBuilder;
