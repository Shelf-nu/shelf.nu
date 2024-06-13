import { useState } from "react";

import { useNavigation } from "@remix-run/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "~/components/forms/select";
import { Switch } from "~/components/forms/switch";
import { isFormProcessing } from "~/utils/form";

export function SortBy() {
  const [val, setVal] = useState<"name" | "createdAt" | "updatedAt" | null>(
    null
  );
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  function onValueChange(value: "name" | "createdAt" | "updatedAt") {
    setVal(value);
  }

  return (
    <div className="flex gap-2">
      <Select name="orderBy" onValueChange={onValueChange}>
        <SelectTrigger className="h-[40px] w-full px-3 py-[8.5px]">
          <span className="mr-4 text-[14px]">
            {val ? `Sorted by: ${val}` : "Sort by"}
          </span>
        </SelectTrigger>
        <SelectContent className="w-[250px]" position="popper" align="start">
          <div className=" max-h-[320px] overflow-auto">
            <SelectItem value={"name"}>
              <span className="mr-4 text-[14px] font-semibold text-gray-700">
                Name
              </span>
            </SelectItem>
            <SelectItem value={"createdAt"}>
              <span className="mr-4 text-[14px] font-semibold text-gray-700">
                Date created
              </span>
            </SelectItem>
            <SelectItem value={"updatedAt"}>
              <span className="mr-4 text-[14px] font-semibold text-gray-700">
                Date updated
              </span>
            </SelectItem>
          </div>
        </SelectContent>
      </Select>
      {val && (
        <div className="flex flex-col  ">
          <div>
            <label className="text-[14px] font-medium text-gray-700">
              Ascending
            </label>
          </div>
          <Switch
            name={"direction"}
            disabled={disabled}
            defaultChecked={false}
            className="h-[14px] w-[30px] [&>span]:size-4"
          />
        </div>
      )}
    </div>
  );
}
