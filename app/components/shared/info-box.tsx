import { useState } from "react";
import { tw } from "~/utils/tw";

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
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="size-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
