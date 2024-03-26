import { tw } from "~/utils/tw";

export function WarningBox({
  children,
  ...rest
}: {
  children: JSX.Element | JSX.Element[] | string;
  [key: string]: any;
}) {
  return (
    <div
      className={tw(
        " b-warning-300 rounded border bg-warning-25 p-4 text-sm text-warning-700",
        rest?.className || ""
      )}
    >
      {children}
    </div>
  );
}
