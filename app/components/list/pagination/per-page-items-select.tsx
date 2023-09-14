import { useEffect, useState } from "react";
import {
  Form,
  useLoaderData,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "~/components/forms";

export default function PerPageItemsSelect() {
  const perPageValues = ["20", "50", "100"];
  const [perPageLocalValue, setPerPageLocalValue] = useState<string>("20");
  const submit = useSubmit();
  const [searchParams] = useSearchParams();

  const { perPage } = useLoaderData();

  /** This effect handles setting the default perPage value
   * We have some priorities we need to handle
   * 1. If the param exists, that takes priority, because it reflects the latest state based on the action taken by the user(changing the select)
   * 2. If it doesnt, set the value to perPage from the loader data
   */
  useEffect(() => {
    if (perPage) {
      setPerPageLocalValue(() => perPage);
    }
  }, [perPage, setPerPageLocalValue]);

  return (
    <div className="relative">
      <Form
        onChange={(e) => {
          submit(e.currentTarget);
        }}
      >
        {/* Get all the existing params and add them as hidden fields. Skip per_page as that is being added by the select field */}
        {Array.from(searchParams.entries()).map(([key, value]) =>
          key !== "per_page" ? (
            <input type="hidden" name={key} value={value} key={value} />
          ) : null
        )}
        <Select
          name="per_page"
          value={perPageLocalValue.toString()}
          onValueChange={(value) => {
            setPerPageLocalValue(() => value);
          }}
        >
          <SelectTrigger className="px-3.5 py-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-[250px]" position="popper" align="start">
            <div className=" max-h-[320px] overflow-auto">
              {perPageValues.map((value) => (
                <SelectItem value={value} key={value}>
                  <span className="mr-4 text-[14px] font-semibold text-gray-700">
                    {value}
                  </span>
                </SelectItem>
              ))}
            </div>
          </SelectContent>
        </Select>
      </Form>
    </div>
  );
}
