import type { CustomField } from "@prisma/client";
import { Link, useLoaderData } from "@remix-run/react";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { SearchIcon } from "../icons";
import { Button } from "../shared";

export default function AssetCustomFields() {
  /** Get the custom fields from the loader */
  const { customFields } = useLoaderData();

  return (
    <div className="border-b pb-6">
      <div className="mb-6 border-b pb-5">
        <h2 className="mb-1 text-[18px] font-semibold">Custom Fields</h2>
        <Link
          to="/settings/custom-fields"
          className="font-medium text-primary-600"
        >
          Manage custom fields
        </Link>
      </div>
      {customFields.length > 0 ? (
        customFields.map((field: CustomField) => (
          <FormRow
            key={field.id}
            rowLabel={field.name}
            subHeading={field.helpText ? <p>{field.helpText}</p> : undefined}
            className="border-b-0"
          >
            <Input
              hideLabel
              type={field.type}
              label={field.name}
              name={field.name}
              className="w-full"
            />
          </FormRow>
        ))
      ) : (
        <div>
          <div className=" mx-auto max-w-[640px] rounded-xl border border-gray-300 bg-white px-5 py-10 text-center">
            <div>
              <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
                <SearchIcon />
              </div>
              <h4 className="mb-6 text-base">No active custom fields</h4>
              <Button to="/settings/custom-fields/new" variant="primary">
                Create custom fields
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
