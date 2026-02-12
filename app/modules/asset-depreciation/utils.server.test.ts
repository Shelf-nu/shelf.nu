import { describe, expect, it } from "vitest";
import { buildStraightLineSchedule } from "./utils.server";

describe("buildStraightLineSchedule", () => {
  it("prorates the first period and ends on residual value", () => {
    const schedule = buildStraightLineSchedule({
      assetValue: 1200,
      residualValue: 0,
      depreciationRate: 20,
      period: "MONTHLY",
      startDate: new Date("2025-01-15"),
      currencyDigits: 2,
    });

    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0].periodEnd.toISOString().slice(0, 10)).toBe("2025-01-31");
    const last = schedule[schedule.length - 1];
    expect(last.carryingAmount).toBeLessThanOrEqual(0.05);
  });

  it("never depreciates below residual value", () => {
    const schedule = buildStraightLineSchedule({
      assetValue: 1000,
      residualValue: 100,
      depreciationRate: 10,
      period: "ANNUAL",
      startDate: new Date("2024-01-01"),
      currencyDigits: 2,
    });

    const last = schedule[schedule.length - 1];
    expect(last.carryingAmount).toBeCloseTo(100, 2);
  });

  it("uses leap-year day count when prorating annual depreciation", () => {
    const schedule = buildStraightLineSchedule({
      assetValue: 1000,
      residualValue: 0,
      depreciationRate: 50,
      period: "ANNUAL",
      startDate: new Date("2024-07-01"),
      currencyDigits: 2,
    });

    expect(schedule.length).toBeGreaterThan(1);
    expect(schedule[0].periodEnd.toISOString().slice(0, 10)).toBe("2024-12-31");
    expect(schedule[0].daysInPeriod).toBe(184);
    expect(schedule[0].depreciationAmount).toBeCloseTo(251.37, 2);
  });

  it("stops the schedule at the disposal date", () => {
    const disposedAt = new Date("2025-03-10");
    const schedule = buildStraightLineSchedule({
      assetValue: 1200,
      residualValue: 0,
      depreciationRate: 20,
      period: "MONTHLY",
      startDate: new Date("2025-01-01"),
      disposedAt,
      currencyDigits: 2,
    });

    expect(schedule.length).toBeGreaterThan(0);
    const last = schedule[schedule.length - 1];

    expect(last.periodEnd.toISOString().slice(0, 10)).toBe("2025-03-10");
    expect(
      schedule.every((row) => row.periodEnd.getTime() <= disposedAt.getTime())
    ).toBe(true);
  });
});
