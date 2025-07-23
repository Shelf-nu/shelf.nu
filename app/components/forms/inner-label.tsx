/**
 * Place before an input to render a label inside for it
 * This is not an actual <label> element. By default its a span, but can be used as a label as well
 */

import { tw } from "~/utils/tw";

export function InnerLabel({
  hideLg,
  required,
  children,
  className,
}: {
  /** Hide on large screens */
  hideLg?: boolean;
  required?: boolean;
  children: string | React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={tw(
        `inner-label`,
        `mb-[6px] text-text-sm font-medium text-color-700`,
        hideLg && "lg:hidden",
        required && "required-input-label",
        className
      )}
    >
      {children}
    </div>
  );
}
