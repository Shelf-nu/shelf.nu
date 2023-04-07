import type { ReactNode } from "react";
import { SearchForm } from "./search-form";

export const Filters = ({ children }: { children?: ReactNode }) => (
  <div className="flex items-center justify-between rounded-[12px] border border-gray-200 bg-white px-6 py-5">
    <SearchForm />
    {children}
  </div>
);
