import { Link, useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/assets.$assetId.overview.assign-custody";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../forms/select";
import { Button } from "../shared/button";

export default function TemplateSelect() {
  const { templates } = useLoaderData<typeof loader>();

  return (
    <div className="relative w-full">
      <Select name="template">
        <SelectTrigger className="text-left">
          <SelectValue placeholder="Select a PDF template" />
        </SelectTrigger>
        <div>
          <SelectContent
            className="w-[352px]"
            position="popper"
            align="start"
            ref={(ref) =>
              ref?.addEventListener("touchend", (e) => e.preventDefault())
            }
          >
            {templates.length > 0 ? (
              <div className="max-h-[320px] overflow-auto">
                {templates.map((template) => (
                  <SelectItem
                    key={template.id}
                    value={JSON.stringify({
                      id: template.id,
                      name: template.name,
                    })}
                    className="flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100"
                  >
                    <span className="flex-1 font-medium text-gray-900">
                      {template.name}
                    </span>
                  </SelectItem>
                ))}
              </div>
            ) : (
              <div>
                No team PDF templates found.{" "}
                <Button to={"/settings/template"} variant="link">
                  Create PDF template
                </Button>
              </div>
            )}
          </SelectContent>
        </div>
      </Select>
      <div className="mt-2 text-sm text-gray-500">
        Manage PDF templates in{" "}
        <Link className="text-gray-800 underline" to={"/settings/template"}>
          settings
        </Link>
      </div>
    </div>
  );
}
