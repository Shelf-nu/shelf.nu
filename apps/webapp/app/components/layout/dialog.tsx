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
        {/*
         * md:max-h-[calc(100vh-4rem)]: on desktop the dialog is `md:h-auto` and
         * the backdrop centers it without scrolling, so a tall body (e.g. the
         * 450px QR relink scanner) overflowed the viewport top AND bottom on
         * short windows and pushed the footer action off-screen with no way to
         * reach it.
         *
         * The cap must sit on THIS flex panel, not on the `h-auto` dialog: a
         * `h-full` child cannot resolve a percentage height against an
         * auto-height parent, so a cap on the dialog is a no-op, whereas a cap
         * on the flex column makes the `dialog-body` (grow overflow-auto)
         * shrink and scroll.
         *
         * why calc(100vh-4rem) and not 90vh: 4rem is the dialog's own
         * `md:py-8`, so the dialog lands at exactly 100vh instead of
         * overflowing. It also matches the height the near-fullscreen dialogs
         * already set for themselves (`md:h-[calc(100vh-4rem)] md:py-0` in the
         * PDF and image previews); a 90vh cap would have silently shrunk those.
         *
         * Only applies at md+; mobile keeps its `h-[100dvh]` behavior.
         */}
        <div className="flex h-full cursor-default flex-col bg-white md:max-h-[calc(100vh-4rem)]">
          <div
            className={tw(
              "dialog-header flex items-start justify-between bg-white px-6 py-3",
              headerClassName
            )}
          >
            {title}
            <Button
              type="button"
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
