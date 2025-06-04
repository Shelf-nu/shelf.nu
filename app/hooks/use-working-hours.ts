import useApiQuery from "~/hooks/use-api-query";
import type { WorkingHoursData } from "~/modules/working-hours/types";

interface WorkingHoursApiResponse {
  workingHours: WorkingHoursData;
}

export interface UseWorkingHoursResult {
  workingHours: WorkingHoursData | null;
  isLoading: boolean;
  error: string | undefined;
}

export function useWorkingHours(organizationId: string): UseWorkingHoursResult {
  const { data, isLoading, error } = useApiQuery<WorkingHoursApiResponse>({
    api: `/api/${organizationId}/working-hours`,
    enabled: Boolean(organizationId),
  });

  return {
    workingHours: data?.workingHours || null,
    isLoading,
    error,
  };
}
