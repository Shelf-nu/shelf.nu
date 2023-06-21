import { useEffect, useRef } from "react";
import Input from "~/components/forms/input";

export const SearchInput = ({
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
      label="Search locations"
      placeholder="Search locations"
      hideLabel
      className="mb-2 text-gray-500"
      icon="coins"
      value={filter}
      onChange={handleFilter}
      ref={inputRef}
      autoFocus
    />
  );
};
