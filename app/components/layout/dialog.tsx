import type { ReactNode } from "react";
import { useMatches } from "@remix-run/react";
import { Button } from "../shared";
import { XIcon } from "../icons";

export const Dialog = ({
  children,
  open,
}: {
  children: ReactNode;
  open: boolean;
}) => {
  const matches = useMatches();
  const prevRoute = matches[matches.length - 2];

  return open ? (
    <div className="dialog-backdrop">
      <dialog className="dialog" open={true}>
        <Button
          to={prevRoute}
          variant="link"
          className={"absolute right-6 top-[26px] leading-none text-gray-500"}
        >
          <XIcon />
        </Button>
        {children}
      </dialog>
    </div>
  ) : null;
};
