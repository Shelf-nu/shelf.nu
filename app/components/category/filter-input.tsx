import { useEffect, useRef } from "react";
import Input from "../forms/input";

export const FilterInput = ({
  filter,
  handleFilter,
}: {
  filter: string;
  handleFilter: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>();

  useEffect(() => {
    inputRef?.current?.focus();
  }, []);

  return (
    <Input
      type="text"
      label="Search categories"
      placeholder="Search categories"
      hideLabel
      className="mb-2 text-color-500"
      icon="coins"
      value={filter}
      onChange={handleFilter}
      ref={inputRef}
      autoFocus
    />
  );
};
