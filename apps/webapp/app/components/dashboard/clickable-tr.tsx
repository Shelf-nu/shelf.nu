import type { KeyboardEvent, ReactNode } from "react";
import { useNavigate } from "react-router";
import { tw } from "~/utils/tw";

/**
 * A table row that navigates on click. Used only in Home dashboard widgets.
 * Skips navigation when the user clicks an interactive element (link/button) inside the row.
 * Keyboard accessible: focusable, activates on Enter/Space.
 */
export function ClickableTr({
  children,
  className,
  to,
}: {
  children?: ReactNode;
  className?: string;
  to: string;
}) {
  const navigate = useNavigate();

  const handleNavigate = () => {
    void navigate(to);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleNavigate();
    }
  };

  return (
    <tr
      tabIndex={0}
      role="link"
      className={tw(
        "cursor-pointer hover:bg-color-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
        className
      )}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a, button")) return;
        handleNavigate();
      }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </tr>
  );
}
