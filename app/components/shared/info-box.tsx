import type { JSX } from "react";
import { useState } from "react";
import { tw } from "~/utils/tw";
import { XIcon } from "../icons/library";

export function InfoBox({
  children,
  ...rest
}: {
  children: JSX.Element | JSX.Element[] | string;
  [key: string]: any;
}) {
  const [visible, setVisible] = useState(true);
  return (
    <div
      className={tw(
        "relative rounded border border-blue-500 bg-blue-50 p-4 text-sm text-blue-500 ",
        visible ? "block" : "hidden",
        rest?.className || ""
      )}
    >
      {children}
      <button
        className="absolute right-2 top-2"
        onClick={() => setVisible(false)}
        type="button"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
