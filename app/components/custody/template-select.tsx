import { Link, useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/assets.$assetId.give-custody";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../forms";
import { Button } from "../shared";

export default function TemplateSelect() {
  const { templates } = useLoaderData<typeof loader>();
  return (
    <div className="relative w-full">
      <Select name="template">
        <SelectTrigger>
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
              <div className=" max-h-[320px] overflow-auto">
                {templates.map((template) => (
                  <SelectItem
                    key={template.id}
                    value={JSON.stringify({
                      id: template.id,
                      name: template.name,
                    })}
                  >
                    <span className=" flex-1 font-medium text-gray-900">
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
