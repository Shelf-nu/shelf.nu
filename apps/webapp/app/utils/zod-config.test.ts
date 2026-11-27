/**
 * Pins the wording of every validation message a schema does not set itself.
 *
 * The app-wide map is installed by importing `~/utils/zod-config`, which the
 * Vitest setup file does, so these schemas are parsed exactly as a route or a
 * form would parse them.
 *
 * @see {@link file://./zod-config.ts}
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { INVALID_VALUE_MESSAGE, REQUIRED_MESSAGE } from "./zod-config";

/** A two-member enum, standing in for a Prisma enum. */
const Colour = { RED: "RED", BLUE: "BLUE" } as const;

/**
 * Parses `input` and returns the message of the first issue.
 *
 * @param schema - The schema under test, built without a message of its own
 * @param input - A value the schema rejects
 * @returns The first issue's message
 */
function firstMessage(schema: z.ZodType, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) {
    throw new Error("Expected the schema to reject the input");
  }
  return result.error.issues[0].message;
}

/** One row per kind of failure: label, schema, rejected input, message. */
const CASES: Array<[string, z.ZodType, unknown, string]> = [
  // Missing and blank values
  ["a missing string", z.string(), undefined, REQUIRED_MESSAGE],
  ["a null string", z.string(), null, REQUIRED_MESSAGE],
  ["a missing number", z.number(), undefined, REQUIRED_MESSAGE],
  [
    "a required key that is absent from an object",
    z.object({ agreed: z.coerce.boolean() }),
    {},
    REQUIRED_MESSAGE,
  ],
  ["an empty string under min(1)", z.string().min(1), "", REQUIRED_MESSAGE],

  // Wrong types
  ["text where a number goes", z.number(), "abc", "Must be a number"],
  ["unreadable coerced number", z.coerce.number(), "abc", "Must be a number"],
  ["a fraction under int()", z.number().int(), 1.5, "Must be a whole number"],
  ["an unreadable date", z.coerce.date(), "nope", "Must be a valid date"],
  ["a number where text goes", z.string(), 5, INVALID_VALUE_MESSAGE],
  ["text where a boolean goes", z.boolean(), "x", INVALID_VALUE_MESSAGE],

  // Too short, too small, too few
  ["a short string", z.string().min(4), "ab", "Must be at least 4 characters"],
  [
    "a string of the wrong exact length",
    z.string().length(6),
    "ab",
    "Must be exactly 6 characters",
  ],
  ["a number under min", z.number().min(1), 0, "Must be at least 1"],
  [
    "a number under positive()",
    z.number().positive(),
    0,
    "Must be greater than 0",
  ],
  [
    "a negative under nonnegative()",
    z.number().nonnegative(),
    -1,
    "Must be at least 0",
  ],
  [
    "an empty list under min(1)",
    z.array(z.string()).min(1),
    [],
    "Select at least one",
  ],
  ["a short list", z.array(z.string()).min(3), ["a"], "Select at least 3"],
  [
    "a date before the minimum",
    z.date().min(new Date("2030-01-01")),
    new Date("2020-01-01"),
    "Date is too early",
  ],

  // Too long, too large, too many
  [
    "a long string",
    z.string().max(3),
    "abcdef",
    "Must be at most 3 characters",
  ],
  ["a number over max", z.number().max(5), 9, "Must be at most 5"],
  [
    "a number over a large max",
    z.number().max(10_000),
    20_000,
    "Must be at most 10,000",
  ],
  [
    "a list over its cap",
    z.array(z.string()).max(2),
    ["a", "b", "c"],
    "Too many items. The limit is 2.",
  ],
  [
    "a date after the maximum",
    z.date().max(new Date("2020-01-01")),
    new Date("2030-01-01"),
    "Date is too late",
  ],

  // Formats
  ["a malformed email", z.string().email(), "x", "Please enter a valid email"],
  ["a malformed URL", z.string().url(), "x", "Please enter a valid URL"],
  [
    "a malformed datetime",
    z.string().datetime(),
    "x",
    "Please enter a valid date",
  ],
  ["a malformed uuid", z.string().uuid(), "x", "Invalid format"],
  ["text failing a regex", z.string().regex(/^a/), "x", "Invalid format"],

  // Choices
  [
    "a value outside an enum",
    z.enum(["A", "B"]),
    "C",
    "Please select a valid option",
  ],
  [
    "a value outside a native enum",
    z.nativeEnum(Colour),
    "GREEN",
    "Please select a valid option",
  ],
  [
    "a value that is not the literal",
    z.literal("on"),
    "off",
    INVALID_VALUE_MESSAGE,
  ],

  // Everything else
  [
    "a multiple-of miss",
    z.number().multipleOf(5),
    3,
    "Must be a multiple of 5",
  ],
  [
    "a value matching no union member",
    z.union([z.string(), z.number()]),
    true,
    INVALID_VALUE_MESSAGE,
  ],
  [
    "an unknown key on a strict object",
    z.strictObject({ a: z.string() }),
    { a: "x", b: 1 },
    INVALID_VALUE_MESSAGE,
  ],
  [
    "a refinement without a message",
    z.string().refine(() => false),
    "x",
    INVALID_VALUE_MESSAGE,
  ],
];

describe("default validation messages", () => {
  it.each(CASES)("words %s", (_label, schema, input, expected) => {
    expect(firstMessage(schema, input)).toBe(expected);
  });

  it("never falls back to zod's own wording", () => {
    const zodWording =
      /^(Invalid input|Too small|Too big|Invalid option|Invalid string|Invalid number|Unrecognized|Invalid email address|Invalid URL|Invalid UUID|Invalid ISO)/;

    for (const [label, schema, input] of CASES) {
      expect(firstMessage(schema, input), label).not.toMatch(zodWording);
    }
  });
});

describe("a message set on the schema", () => {
  it("wins over the default for a check", () => {
    expect(firstMessage(z.string().min(1, "Name is required"), "")).toBe(
      "Name is required"
    );
  });

  it("wins over the default for a refinement", () => {
    expect(
      firstMessage(
        z.string().refine(() => false, { message: "Pick another" }),
        "x"
      )
    ).toBe("Pick another");
  });

  it("wins over the default for a missing value", () => {
    expect(
      firstMessage(z.string({ error: "Please select a location" }), undefined)
    ).toBe("Please select a location");
  });
});
