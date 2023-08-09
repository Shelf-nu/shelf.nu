import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "~/components/forms";

export default function PerPageItemsSelect() {
  const perPageValues = [50, 100, 150, 200];
  return (
    <div className="relative">
      <Select name="perPageItems" defaultValue={perPageValues[0].toString()}>
        <SelectTrigger className="px-3.5 py-3">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="w-[250px]" position="popper" align="start">
          <div className=" max-h-[320px] overflow-auto">
            {perPageValues.map((value) => (
              <SelectItem value={value.toString()} key={value}>
                <span className="mr-4 text-[14px] font-semibold text-gray-700">
                  {value}
                </span>
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
