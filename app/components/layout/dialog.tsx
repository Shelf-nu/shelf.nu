import type { ReactNode } from "react";
import ReactDOM from "react-dom";
import { tw } from "~/utils/tw";
import { XIcon } from "../icons/library";
import { Button } from "../shared/button";

export const Dialog = ({
  title,
  children,
  open,
  onClose,
  className,
}: {
  title: string | ReactNode;
  children: ReactNode;
  open: boolean;
  onClose: Function;
  className?: string;
}) =>
  open ? (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <dialog className={tw("dialog", className)} open={true}>
        <div className="flex h-full flex-col bg-white">
          <div className="dialog-header flex items-start justify-between bg-white px-6 py-3">
            {title}
            <Button
              onClick={onClose}
              variant="link"
              className={"mt-4 leading-none text-gray-500 md:right-6"}
            >
              <XIcon />
            </Button>
          </div>
          <div className="grow overflow-auto">{children}</div>
        </div>
      </dialog>
    </div>
  ) : null;

export const DialogPortal = ({ children }: { children: React.ReactNode }) =>
  ReactDOM.createPortal(children, document.body);
