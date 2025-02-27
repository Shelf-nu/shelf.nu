import { useState } from "react";
import type { Template } from "@prisma/client";
import { Link } from "@remix-run/react";
import useApiQuery from "~/hooks/use-api-query";
import { tw } from "~/utils/tw";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Switch } from "../forms/switch";
import { Button } from "../shared/button";
import { CustomTooltip } from "../shared/custom-tooltip";
import When from "../when/when";

type TemplateSelectorProps = {
  className?: string;
  hasCustodianSelected: boolean;
  disabled?: boolean;
};

export default function TemplateSelector({
  className,
  hasCustodianSelected,
  disabled,
}: TemplateSelectorProps) {
  const [addTemplateEnabled, setAddTemplateEnabled] = useState(false);
  const { isLoading, data } = useApiQuery<{ templates: Template[] }>({
    api: "/api/templates",
    enabled: addTemplateEnabled,
  });

  const templates = data?.templates;

  if (!hasCustodianSelected) {
    return (
      <div className={tw("flex gap-x-2", className)}>
        <CustomTooltip
          content={
            <TooltipContent
              title="Please select a custodian"
              message="You need to select a custodian before you can add a PDF template."
            />
          }
        >
          <Switch required={false} disabled={!hasCustodianSelected} />
        </CustomTooltip>
        <PdfSwitchLabel hasTemplates={!!templates?.length} />
      </div>
    );
  }

  return (
    <div className={tw("w-full", className)}>
      <div className="mb-5 flex gap-x-2">
        <Switch
          onClick={() => setAddTemplateEnabled((prev) => !prev)}
          defaultChecked={addTemplateEnabled}
          required={false}
          disabled={disabled}
        />
        <input
          type="hidden"
          name="addTemplateEnabled"
          value={addTemplateEnabled.toString()}
        />
        <PdfSwitchLabel hasTemplates={!!templates?.length} />
      </div>

      <When truthy={addTemplateEnabled}>
        <Select name="template" disabled={isLoading}>
          <SelectTrigger className="text-left">
            <SelectValue placeholder="Select a PDF template" />
          </SelectTrigger>

          <SelectContent
            className="w-[352px]"
            position="popper"
            align="start"
            ref={(ref) =>
              ref?.addEventListener("touchend", (e) => e.preventDefault())
            }
          >
            <When
              truthy={!!templates?.length}
              fallback={
                <div>
                  No team PDF templates found.{" "}
                  <Button to="/settings/template" variant="link">
                    Create PDF template
                  </Button>
                </div>
              }
            >
              <div className="max-h-[320px] overflow-auto">
                {templates?.map((template) => (
                  <SelectItem
                    key={template.id}
                    value={template.id}
                    className="flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100"
                  >
                    {template.name}
                  </SelectItem>
                ))}
              </div>
            </When>
          </SelectContent>
        </Select>
        <div className="mt-2 text-sm text-gray-500">
          Manage PDF templates in{" "}
          <Link
            target="_blank"
            className="text-gray-800 underline"
            to={"/settings/template"}
          >
            settings
          </Link>
        </div>
      </When>
    </div>
  );
}

export function TooltipContent({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div>
      <div>
        <div className="text-md mb-2 font-semibold text-gray-700">{title}</div>
        <div className="text-sm text-gray-500">{message}</div>
      </div>
    </div>
  );
}

function PdfSwitchLabel({ hasTemplates }: { hasTemplates: boolean }) {
  return (
    <div className="flex flex-col gap-y-1">
      <div className="text-md font-semibold text-gray-600">
        Add PDF Template
      </div>
      <p className="text-sm text-gray-500">
        {hasTemplates
          ? "Custodian needs to read (and sign) a document before receiving custody."
          : "You need to create templates before you can add them here."}
        {hasTemplates ? (
          <Link target="_blank" className="text-gray-700 underline" to="#">
            Learn more
          </Link>
        ) : (
          <Link
            target="_blank"
            className="text-gray-700 underline"
            to="/settings/template/new"
          >
            Create a template
          </Link>
        )}
      </p>
    </div>
  );
}
