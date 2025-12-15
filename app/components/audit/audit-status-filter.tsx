import { useNavigation } from "react-router";
import { useSearchParams } from "~/hooks/search-params";
import { isFormProcessing } from "~/utils/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";

type AuditStatusFilterProps = {
  statusItems: Record<string, string>;
  name?: string;
};

/**
 * Status filter specifically for audit pages.
 * Includes an "ALL" option to view all assets (expected + unexpected) in one list.
 * Default filter is EXPECTED.
 */
export function AuditStatusFilter(props: AuditStatusFilterProps) {
  const { statusItems, name = "auditStatus" } = props;
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get(name);

  function handleValueChange(value: string) {
    setSearchParams((prev) => {
      prev.set(name, value);
      return prev;
    });
  }

  return (
    <div className="w-full md:w-auto">
      <Select
        name={name}
        defaultValue={status || "EXPECTED"}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label="Filter by audit status"
          className="mt-2 px-3.5 py-2 text-left text-base text-gray-500 md:mt-0 md:max-w-fit"
        >
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-full min-w-[300px] p-0"
          align="start"
        >
          <div className="max-h-[320px] overflow-auto">
            {["ALL", ...Object.values(statusItems)].map((value) => (
              <SelectItem
                value={value}
                key={value}
                className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
              >
                <span className="mr-4 block text-[14px] lowercase text-gray-700 first-letter:uppercase">
                  {value.split("_").join(" ")}
                </span>
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
