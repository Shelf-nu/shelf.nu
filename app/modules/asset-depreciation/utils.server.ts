import type { DepreciationPeriod } from "@prisma/client";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  isBefore,
  isEqual,
  isLeapYear,
  min as minDate,
} from "date-fns";
import { getPeriodsPerYear, getUsefulLifeYears } from "./utils.shared";

export type DepreciationScheduleRow = {
  periodStart: Date;
  periodEnd: Date;
  daysInPeriod: number;
  depreciationAmount: number;
  accumulatedDepreciation: number;
  carryingAmount: number;
};

function roundToCurrency(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getPeriodEnd(start: Date, period: DepreciationPeriod): Date {
  switch (period) {
    case "MONTHLY":
      return endOfMonth(start);
    case "QUARTERLY":
      return endOfQuarter(start);
    case "ANNUAL":
      return endOfYear(start);
    default:
      return endOfMonth(start);
  }
}

function calcUsefulLifeMonths(ratePercent: number): number {
  const years = 100 / ratePercent;
  return Math.round(years * 12);
}

export function buildStraightLineSchedule({
  assetValue,
  residualValue,
  depreciationRate,
  period,
  startDate,
  disposedAt,
  currencyDigits,
}: {
  assetValue: number;
  residualValue: number;
  depreciationRate: number;
  period: DepreciationPeriod;
  startDate: Date;
  disposedAt?: Date | null;
  currencyDigits: number;
}): DepreciationScheduleRow[] {
  if (assetValue <= 0 || depreciationRate <= 0) {
    return [];
  }

  const depreciableBase = Math.max(assetValue - residualValue, 0);
  if (depreciableBase <= 0) {
    return [];
  }

  const usefulLifeMonths = calcUsefulLifeMonths(depreciationRate);
  const endDate = addDays(addMonths(startDate, usefulLifeMonths), -1);
  const stopDate = disposedAt ? minDate([endDate, disposedAt]) : endDate;

  const annualDepreciation = depreciableBase * (depreciationRate / 100);
  const rows: DepreciationScheduleRow[] = [];

  let currentStart = startDate;
  let accumulated = 0;

  while (
    (isBefore(currentStart, stopDate) || isEqual(currentStart, stopDate)) &&
    accumulated < depreciableBase
  ) {
    const periodEnd = minDate([getPeriodEnd(currentStart, period), stopDate]);
    const daysInPeriod = differenceInCalendarDays(periodEnd, currentStart) + 1;
    const daysInYear = isLeapYear(currentStart) ? 366 : 365;

    const rawAmount = annualDepreciation * (daysInPeriod / daysInYear);
    let depreciationAmount = roundToCurrency(rawAmount, currencyDigits);

    const remaining = roundToCurrency(
      depreciableBase - accumulated,
      currencyDigits
    );
    if (depreciationAmount > remaining) {
      depreciationAmount = remaining;
    }

    accumulated = roundToCurrency(
      accumulated + depreciationAmount,
      currencyDigits
    );
    const carryingAmount = roundToCurrency(
      assetValue - accumulated,
      currencyDigits
    );

    rows.push({
      periodStart: currentStart,
      periodEnd,
      daysInPeriod,
      depreciationAmount,
      accumulatedDepreciation: accumulated,
      carryingAmount,
    });

    currentStart = addDays(periodEnd, 1);

    // Guard against infinite loops when periods do not advance
    if (
      rows.length > 1 &&
      rows[rows.length - 1].periodEnd.getTime() ===
        rows[rows.length - 2].periodEnd.getTime()
    ) {
      break;
    }
  }

  return rows;
}

export { getPeriodsPerYear, getUsefulLifeYears };
