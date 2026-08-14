import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const ORG = "cmn8vu17y001rooi1l2etdpzf";           // GRANULAR WORKSPACE
const USER = "694aa6ec-5df0-4b11-8b0e-bc5cbd962579"; // carlitos qa-admin1

const tm = await db.teamMember.findFirst({
  where: { organizationId: ORG, userId: USER, deletedAt: null },
  select: { id: true, name: true },
});
if (!tm) throw new Error("no team member for that user in this org");

const d = (m, day, h = 9) => new Date(2026, m - 1, day, h, 0, 0);

/** Deliberately nasty shapes, not tidy ones. */
const rows = [
  // A heavy cluster on one day: tests the per-cell band cap (7 overlapping).
  ...Array.from({ length: 7 }, (_, i) => ({
    name: `ZZ Load — same-day overlap ${i + 1}`,
    from: d(9, 8, 8 + i), to: d(9, 8, 17), status: "RESERVED",
  })),
  // Long runs crossing week rows and the month edge.
  { name: "ZZ Load — three week run", from: d(9, 2), to: d(9, 22), status: "RESERVED" },
  { name: "ZZ Load — crosses into October", from: d(9, 25), to: d(10, 6), status: "RESERVED" },
  { name: "ZZ Load — crosses in from August", from: d(8, 28), to: d(9, 4), status: "ONGOING" },
  // Back to back, no gap: must read as two runs, not one.
  { name: "ZZ Load — back to back A", from: d(9, 10), to: d(9, 12), status: "ONGOING" },
  { name: "ZZ Load — back to back B", from: d(9, 13), to: d(9, 15), status: "OVERDUE" },
  // Every status, so colour coding is exercised.
  { name: "ZZ Load — draft", from: d(9, 17), to: d(9, 18), status: "DRAFT" },
  { name: "ZZ Load — complete", from: d(9, 19), to: d(9, 20), status: "COMPLETE" },
  { name: "ZZ Load — overdue", from: d(9, 5), to: d(9, 6), status: "OVERDUE" },
  // Single days scattered so the month is not uniformly full.
  ...[1, 7, 16, 23, 29].map((day) => ({
    name: `ZZ Load — single ${day} Sep`,
    from: d(9, day), to: d(9, day, 17), status: "RESERVED",
  })),
  // Should never be drawn.
  { name: "ZZ Load — cancelled (must not show)", from: d(9, 11), to: d(9, 11), status: "CANCELLED" },
  { name: "ZZ Load — archived (must not show)", from: d(9, 24), to: d(9, 24), status: "ARCHIVED" },
];

let made = 0;
for (const r of rows) {
  await db.booking.create({
    data: {
      name: r.name,
      from: r.from,
      to: r.to,
      status: r.status,
      organizationId: ORG,
      creatorId: USER,
      custodianTeamMemberId: tm.id,
    },
  });
  made++;
}
console.log(`created ${made} bookings for ${tm.name}`);
await db.$disconnect();
