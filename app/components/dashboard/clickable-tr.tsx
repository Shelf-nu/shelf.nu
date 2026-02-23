import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { tw } from "~/utils/tw";

/**
 * A table row that navigates on click. Used only in Home dashboard widgets.
 * Skips navigation when the user clicks an interactive element (link/button) inside the row.
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

  return (
    <tr
      className={tw("cursor-pointer hover:bg-gray-50", className)}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a, button")) return;
        void navigate(to);
      }}
    >
      {children}
    </tr>
  );
}
