import { tw } from "~/utils/tw";
import type { ListProps } from ".";
import BulkListHeader from "./bulk-actions/bulk-list-header";
import { Th } from "../table";

type ListHeaderProps = {
  children: React.ReactNode;
  hideFirstColumn?: boolean;
  bulkActions?: ListProps["bulkActions"];
  title?: string;
  className?: string;
};

export const ListHeader = ({
  children,
  hideFirstColumn = false,
  bulkActions,
  className,
}: ListHeaderProps) => (
  <thead className={tw("border-b", className)}>
    <tr className="">
      {bulkActions ? <BulkListHeader /> : null}
      {hideFirstColumn ? null : (
        <Th
          className={tw(
            "text-left font-normal text-gray-600",
            bulkActions ? "!pl-0" : ""
          )}
          colSpan={children ? 1 : 100}
        >
          Name
        </Th>
      )}
      {children}
    </tr>
  </thead>
);
