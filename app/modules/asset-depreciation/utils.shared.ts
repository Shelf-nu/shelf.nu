import type { DepreciationPeriod } from "@prisma/client";

const PERIOD_MONTHS: Record<DepreciationPeriod, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

export function getPeriodsPerYear(period: DepreciationPeriod): number {
  return 12 / PERIOD_MONTHS[period];
}

export function getUsefulLifeYears(depreciationRate: number): number {
  return 100 / depreciationRate;
}
