import type { TdHTMLAttributes } from "react";
import React from "react";
import { tw } from "~/utils";

export function Table({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <table className={tw("w-full table-auto border-collapse", className)}>
      {children}
    </table>
  );
}

export function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={tw(
        "border-b p-4 text-left font-normal text-gray-600 md:px-6",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <tr className={tw("hover:bg-gray-50", className)}>{children}</tr>;
}

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children: React.ReactNode;
  className?: string;
}

export function Td({ children, className, ...props }: TdProps) {
  return (
    <td
      className={tw("whitespace-nowrap border-b p-4 md:px-6", className)}
      {...props}
    >
      {children}
    </td>
  );
}
