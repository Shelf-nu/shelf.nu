import useApiQuery from "~/hooks/use-api-query";
import type { WeeklyScheduleJson } from "~/modules/working-hours/types";

interface WorkingHoursOverride {
  id: string;
  date: string; // ISO string
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  reason: string | null;
}

export interface WorkingHoursData {
  id: string;
  enabled: boolean;
  weeklySchedule: WeeklyScheduleJson;
  overrides: WorkingHoursOverride[];
}

interface WorkingHoursApiResponse {
  workingHours: WorkingHoursData;
}

interface UseWorkingHoursResult {
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
