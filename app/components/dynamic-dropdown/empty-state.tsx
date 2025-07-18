import { SearchIcon } from "../icons/library";

export const EmptyState = ({
  modelName,
  searchQuery,
}: {
  modelName: string;
  searchQuery: string;
}) => (
  <div className="my-16 flex flex-col items-center px-3 text-center">
    <div className="mb-4 rounded-full bg-primary-50  p-2">
      <div className=" rounded-full bg-primary-100 p-2 text-primary">
        <SearchIcon className="h-auto" />
      </div>
    </div>

    <div>
      <div className="text-base font-semibold text-color-900">
        No matching results
      </div>
      <p className="text-sm text-color-600">
        Your search “{searchQuery}” did not match any {modelName}.
      </p>
    </div>
  </div>
);
