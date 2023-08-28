import { json, type V2_MetaFunction } from "@remix-run/node";
import { ActionsDropdown } from "~/components/custom-fields/actions-dropdown";
import { ErrorBoundryComponent } from "~/components/errors";
import { List } from "~/components/list";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const ErrorBoundary = () => <ErrorBoundryComponent />;

export const loader = async () => {
  const modelName = {
    singular: "Custom Field",
    plural: "Custom Fields",
  };

  const items = [
    { id: 1, name: "Field1", type: "text" },
    { id: 2, name: "Field2", type: "text" },
    { id: 3, name: "Field3", type: "text" },
    { id: 4, name: "Field4", type: "text" },
    { id: 5, name: "Field5", type: "text" },
  ];

  return json({
    items,
    page: 1,
    totalItems: items.length,
    perPage: 8,
    totalPages: 1,
    next: "",
    prev: "",
    modelName,
    title: "Custom Fields",
  });
};

export default function CustomFieldsIndexPage() {
  return (
    <>
      <div className="mb-2.5 flex items-center justify-between bg-white md:rounded-[12px] md:border md:border-gray-200 md:px-6 md:py-5">
        <h2 className=" text-lg text-gray-900">Custom Fields</h2>
        <Button
          to="new"
          role="link"
          aria-label={`new custom field`}
          icon="plus"
          data-test-id="createNewCustomField"
        >
          New Custom Field
        </Button>
      </div>
      <List ItemComponent={TeamMemberRow} />
    </>
  );
}
function TeamMemberRow({
  item,
}: {
  item: { id: string; name: string; type: string };
}) {
  return (
    <>
      <Td className="w-full">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text-sm font-medium text-gray-900">
              {item.name}
            </p>
            <span className="text-gray-600">{item.type}</span>
          </div>
          <ActionsDropdown />
        </div>
      </Td>
    </>
  );
}
