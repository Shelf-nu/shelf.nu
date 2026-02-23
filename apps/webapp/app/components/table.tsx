import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { useTableIsOverflowing } from "~/hooks/use-table-overflow";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { tw } from "~/utils/tw";

export function Table({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { vh } = useViewportHeight();
  const { containerRef, isOverflowing } = useTableIsOverflowing();
  const { modeIsAdvanced } = useAssetIndexViewState();

  return (
    <div
      className={tw(
        "relative",
        isOverflowing && "overflowing",
        modeIsAdvanced && "flex flex-1 flex-col"
      )}
    >
      <div
        className={tw(
          "fixed-gradient",
          "right-0"
          // modeIsAdvanced ? "right-0" : "-right-px"
        )}
      ></div>
      <div
        ref={containerRef}
        className={tw(
          "list-table-wrapper",
          modeIsAdvanced
            ? "overflow-auto"
            : "scrollbar-top scrollbar-always-visible"
        )}
        style={
          modeIsAdvanced
            ? {
                maxHeight: `${vh - 280}px`,
                scrollbarWidth: "thin",
              }
            : undefined
        }
      >
        <table className={tw("w-full table-auto border-collapse", className)}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function Th({
  children,
  className,
  colSpan,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
} & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={tw(
        "p-4 text-left font-normal text-gray-600 md:border-b md:px-6",
        className
      )}
      colSpan={colSpan || undefined}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <tr className={tw("hover:bg-gray-50", className)}>{children}</tr>;
}

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode;
  className?: string;
}

export function Td({ children, className, ...props }: TdProps) {
  return (
    <td
      className={tw(
        "max-w-[250px] truncate whitespace-nowrap border-b p-4 md:px-6",
        className
      )}
      {...props}
    >
      {children}
    </td>
  );
}
