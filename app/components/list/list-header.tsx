import type { ListProps } from ".";
import BulkListHeader from "./bulk-actions/bulk-list-header";
import { Th } from "../table";

type ListHeaderProps = {
  children: React.ReactNode;
  hideFirstColumn?: boolean;
  bulkActions?: ListProps["bulkActions"];
  title?: string;
};

export const ListHeader = ({
  children,
  hideFirstColumn = false,
  bulkActions,
}: ListHeaderProps) => (
  <thead className="border-b">
    <tr className="">
      {bulkActions ? <BulkListHeader /> : null}
      {hideFirstColumn ? null : (
        <Th
          className="text-left font-normal text-gray-600"
          colSpan={children ? 1 : 100}
        >
          Name
        </Th>
      )}
      {children}
    </tr>
  </thead>
);
