import type { ReactNode } from "react";
import { useNavigation } from "@remix-run/react";

import { Spinner } from "~/components/shared/spinner";
import { isFormProcessing } from "~/utils";
import { SearchForm } from "./search-form";

export const Filters = ({ children }: { children?: ReactNode }) => {
  const navigation = useNavigation();
  const isProcessing = isFormProcessing(navigation.state);

  return (
    <div className="flex items-center justify-between rounded-[12px] border border-gray-200 bg-white px-6 py-5">
      <div className="flex items-center gap-5">
        <SearchForm />
        {isProcessing && (
          <div className="mt-1">
            <Spinner />
          </div>
        )}
      </div>
      {children}
    </div>
  );
};
