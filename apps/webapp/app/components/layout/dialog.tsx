import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import { XIcon } from "../icons/library";
import { Button } from "../shared/button";

export const Dialog = ({
  title,
  children,
  open,
  onClose,
  className,
  headerClassName,
  wrapperClassName,
}: {
  title: string | ReactNode;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  className?: string;
  headerClassName?: string;
  wrapperClassName?: string;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    previouslyFocusedElement.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
      }
    };

    // Attach to document to capture ESC even when Select or other components are focused
    document.addEventListener("keydown", handleKeyDown, { capture: true });

    const focusTarget =
      dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ||
      dialog.querySelector<HTMLElement>("[autofocus]") ||
      dialog.querySelector<HTMLElement>(
        'input,select,textarea,button,[href],[tabindex]:not([tabindex="-1"])'
      ) ||
      dialog;

    focusTarget.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      previouslyFocusedElement.current?.focus();
      previouslyFocusedElement.current = null;
    };
  }, [open]);

  return open ? (
    <div
      className={tw("dialog-backdrop", wrapperClassName)}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={handleActivationKeyPress(() => onClose())}
    >
      <dialog ref={dialogRef} className={tw("dialog", className)} open={open}>
        <div className="flex h-full cursor-default flex-col bg-white">
          <div
            className={tw(
              "dialog-header flex items-start justify-between bg-white px-6 py-3",
              headerClassName
            )}
          >
            {title}
            <Button
              onClick={onClose}
              variant="link"
              className={"mt-2 leading-none text-gray-500 md:right-6"}
              aria-label="Close dialog"
            >
              <XIcon />
            </Button>
          </div>
          <div className="dialog-body grow overflow-auto">{children}</div>
        </div>
      </dialog>
    </div>
  ) : null;
};

export const DialogPortal = ({ children }: { children: ReactNode }) => {
  if (typeof document === "undefined") return null;
  return ReactDOM.createPortal(children, document.body);
};
