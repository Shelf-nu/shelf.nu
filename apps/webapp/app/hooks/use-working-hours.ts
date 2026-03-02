import { useRouteLoaderData } from "react-router";
import type { WorkingHoursData } from "~/modules/working-hours/types";
import type { LayoutLoaderResponse } from "~/routes/_layout+/_layout";

export interface UseWorkingHoursResult {
  workingHours: WorkingHoursData | null;
  isLoading: boolean;
  error: string | undefined;
}

export function useWorkingHours(): UseWorkingHoursResult {
  const workingHours = useRouteLoaderData<LayoutLoaderResponse>(
    "routes/_layout+/_layout"
  )?.workingHours as WorkingHoursData | undefined;

  return {
    workingHours: workingHours ?? null,
    isLoading: false,
    error: undefined,
  };
}
