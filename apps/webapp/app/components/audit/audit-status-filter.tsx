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
  /**
   * URL value -> the words shown for it. The KEY is what goes in the URL, so
   * it must stay the enum name; the VALUE is final display text, rendered
   * verbatim.
   *
   * why: this used to be a value->value map rendered by de-underscoring the
   * enum, which meant the dropdown could only ever say "Missing" while the
   * statistics tile beside it said "Not scanned" for the same rows.
   *
   * why the name `statusOptions` and not `statusItems`: the sibling
   * `~/components/booking/status-filter` takes a `statusItems` prop with the
   * OPPOSITE contract (values are the URL params, keys are ignored). Both are
   * `Record<string, string>`, so the compiler cannot tell them apart — passing
   * one shape to the other component would silently put display text in the
   * URL and 400 in the loader's Zod enum. A distinct prop name is the only
   * thing that makes the mix-up a compile error.
   */
  statusOptions: Record<string, string>;
  name?: string;
};

/**
 * Status filter specifically for audit pages.
 * Includes an "ALL" option to view all assets (expected + unexpected) in one list.
 * Default filter is ALL (shows all assets).
 */
export function AuditStatusFilter(props: AuditStatusFilterProps) {
  const { statusOptions, name = "auditStatus" } = props;
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get(name);

  function handleValueChange(value: string) {
    setSearchParams((prev) => {
      if (value === "ALL") {
        // Remove the param when selecting ALL (clean URL)
        prev.delete(name);
      } else {
        prev.set(name, value);
      }
      // Reset pagination when the filter changes — a stale `page` offset can
      // otherwise land on an empty page. Mirrors the booking StatusFilter.
      prev.delete("page");
      return prev;
    });
  }

  return (
    <div className="w-full md:w-auto">
      <Select
        name={name}
        value={status || "ALL"}
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
            {[["ALL", "All"] as const, ...Object.entries(statusOptions)].map(
              ([value, itemLabel]) => (
                <SelectItem
                  value={value}
                  key={value}
                  className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
                >
                  {/* why: no `lowercase first-letter:uppercase` here. That
                      transform existed to sentence-case a RAW ENUM; the prop
                      now carries final display text, and lowercasing it would
                      mangle any label with a deliberate internal capital
                      ("QR code", a proper noun). */}
                  <span className="mr-4 block text-[14px] text-gray-700">
                    {itemLabel}
                  </span>
                </SelectItem>
              )
            )}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
