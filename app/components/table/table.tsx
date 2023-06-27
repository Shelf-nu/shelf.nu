import React from "react";
import { tw } from "~/utils";

export function Table({
  tableHeads,
  tableRows,
  className,
}: {
  tableHeads?: React.ReactNode;
  tableRows: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={tw(
        "rounded-[12px] border border-gray-200 bg-white",
        className
      )}
    >
      <table className="w-full table-auto border-collapse">
        {tableHeads ? (
          <thead>
            <tr>{tableHeads}</tr>
          </thead>
        ) : null}
        <tbody>{tableRows}</tbody>
      </table>
    </div>
  );
}

export function TableHead({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={tw(
        "hidden border-b p-4 text-left font-normal text-gray-600 md:table-cell md:px-6",
        className
      )}
    >
      {children}
    </th>
  );
}

export function TableRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <tr className={tw("hover:bg-gray-50", className)}>{children}</tr>;
}

export function TableData({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={tw("whitespace-nowrap border-b p-4 md:px-6", className)}>
      {children}
    </td>
  );
}
