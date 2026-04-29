import type React from "react";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import Input from "../forms/input";

export const FilterInput = ({
  filter,
  handleFilter,
}: {
  filter: string;
  handleFilter: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) => {
  const inputRef = useAutoFocus<HTMLInputElement>();

  return (
    <Input
      type="text"
      label="Search categories"
      placeholder="Search categories"
      hideLabel
      className="mb-2 text-gray-500"
      icon="coins"
      value={filter}
      onChange={handleFilter}
      ref={inputRef}
    />
  );
};
