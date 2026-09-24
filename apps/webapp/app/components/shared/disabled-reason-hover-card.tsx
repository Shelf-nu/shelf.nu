/**
 * Disabled-with-reason hover card.
 *
 * A control that is disabled must be able to say WHY, on every input device:
 *
 * - pointer → the reason opens on hover (Radix HoverCard's own behavior)
 * - touch   → hover never fires, so a tap opens it too (controlled `open`)
 * - AT      → `descriptionId` renders the reason as a visually hidden node the
 *   trigger can point at with `aria-describedby`; the hover card content itself
 *   is not announced (it is unmounted while closed and carries no `role`)
 *
 * This is the single implementation of that pattern. Reach for it directly only
 * when the disabled control is NOT a `Button` — `<Button disabled={{ reason }}>`
 * already renders through this component and wires the description for you.
 *
 * @see {@link file://./button.tsx}
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";

/** Props for {@link DisabledReasonHoverCard} */
type DisabledReasonHoverCardProps = {
  /** Heading above the reason. Defaults to "Action disabled". */
  title?: ReactNode;
  /** Why the control is disabled, and ideally what the user can do about it. */
  reason: ReactNode;
  /**
   * When set, the reason is also rendered into a visually hidden element with
   * this id so the trigger can reference it via `aria-describedby`. Callers own
   * the id (and the `aria-describedby`) because it belongs on the interactive
   * element, which only the caller renders.
   */
  descriptionId?: string;
  /**
   * Merge the trigger's props onto `children` instead of wrapping them in the
   * trigger's own element (Radix `asChild`). Use it whenever `children` is
   * already an interactive element, so the tree doesn't get an anchor around a
   * button.
   */
  asChild?: boolean;
  /** Classes for the trigger element (ignored shape-wise when `asChild`). */
  triggerClassName?: string;
  /** The disabled control. */
  children: ReactNode;
};

/**
 * Wraps a disabled control in a hover card that explains why it is disabled.
 *
 * @param props - See {@link DisabledReasonHoverCardProps}
 * @returns The control, wired to reveal its reason on hover, tap and to AT
 */
export function DisabledReasonHoverCard({
  title = "Action disabled",
  reason,
  descriptionId,
  asChild,
  triggerClassName,
  children,
}: DisabledReasonHoverCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <HoverCard
      openDelay={50}
      closeDelay={50}
      open={open}
      onOpenChange={setOpen}
    >
      <HoverCardTrigger
        asChild={asChild}
        className={triggerClassName}
        onClick={(event) => {
          /**
           * why: open, never toggle. Radix's DismissableLayer already closes
           * the card on `pointerdown` for mouse/pen (before this `click` runs),
           * so a `!prev` toggle would immediately re-open it and the card could
           * never be closed by clicking. Touch takes Radix's other branch — its
           * dismiss runs on the document AFTER this handler — so tap-to-close
           * still works with a plain `true`.
           */
          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </HoverCardTrigger>

      {/* Hover card content is unmounted while closed and has no `role`, so it
      is invisible to a screen reader. This mirror is what `aria-describedby`
      resolves against. */}
      {descriptionId ? (
        <span id={descriptionId} className="sr-only">
          {reason}
        </span>
      ) : null}

      {/* why: aria-hidden — this is the VISUAL copy of the reason. Assistive
      tech gets the same text from the description above, so exposing both
      would announce it twice.
      why: collisionPadding keeps the card inside the viewport — the default
      bottom placement runs off-screen for wide buttons on narrow screens. */}
      <HoverCardContent collisionPadding={8} aria-hidden>
        <h5 className="text-left text-[14px]">{title}</h5>
        <p className="text-left text-[14px]">{reason}</p>
      </HoverCardContent>
    </HoverCard>
  );
}
