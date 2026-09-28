/**
 * Reading a number out of a form field.
 *
 * A form submits strings, so every numeric field needs a string turned into a
 * number. The trap is that JavaScript answers the same thing for a blank field
 * and for a deliberate zero:
 *
 * ```
 * Number("")    === 0
 * Number("   ") === 0
 * Number("0")   === 0
 * Number(" 5 ") === 5
 * Number("abc") === NaN
 * ```
 *
 * So a schema that coerces before deciding "is this blank" has already lost the
 * distinction, and no predicate downstream can recover it. `z.coerce.number()`
 * has the same property and is not a safe replacement on its own.
 *
 * These builders make that decision first, on the trimmed text, and then coerce.
 * They reject text that is not a number at all, so neither can ever yield NaN.
 * They deliberately do NOT apply numeric BOUNDS: a field's own limits belong at
 * its call site, piped after, because what counts as a legal number differs per
 * field (a quantity must be positive, an out-of-stock threshold may be zero).
 *
 * @see {@link file://./search-params-number.ts} the same problem for query
 *   strings, where `NaN` is not the same as absent
 * @see {@link file://./../../../.claude/rules/blank-and-zero-are-different-answers.md}
 */
import { z } from "zod";

/**
 * The text of a numeric field, before it becomes a number.
 *
 * `undefined` is admitted because an unchecked or absent input never reaches the
 * request at all, and that is a blank field rather than a malformed one.
 */
const numericFieldText = z.union([z.string(), z.number(), z.undefined()]);

/**
 * The number this text represents, or the caller's absent value when it is blank.
 *
 * Kept as a named function rather than inlined into a `.transform()` callback:
 * the coercion is only safe because `isBlank` runs first, and stating that in one
 * place is clearer than a suppression comment at the call site. It also keeps the
 * `no-hand-coerced-numeric-transform` lint rule honest, since the rule looks for a
 * callback coercing its own parameter and has no way to know a guard ran.
 */
function coerceOrBlank<TBlank extends null | undefined>(
  value: string | number | undefined,
  blank: TBlank
): number | TBlank {
  return isBlank(value) ? blank : Number(value);
}

/** Whether submitted text means "the operator left this empty". */
function isBlank(value: string | number | undefined): boolean {
  return value === undefined || (typeof value === "string" && !value.trim());
}

/**
 * A numeric field the operator may leave empty.
 *
 * Blank of any shape (absent, `""`, or only spaces) becomes the absent value the
 * caller asks for. Everything else is coerced, so `"0"` is kept as a real zero.
 *
 * @param options.blank - What an empty field becomes. Callers differ and the
 *   difference is load-bearing: a nullable column wants `null`, while a field
 *   whose schema is `.optional()` downstream wants `undefined`.
 * @returns A schema yielding `number`, or the chosen absent value.
 *
 * @example
 * // A nullable money column: blank clears it, "0" stores zero.
 * valuation: optionalNumberFromString({ blank: null }),
 *
 * @example
 * // Bounds still belong to the field, piped after.
 * quantity: optionalNumberFromString({ blank: undefined }).pipe(
 *   z.number().int().positive("Quantity must be at least 1").optional()
 * ),
 */
export function optionalNumberFromString<TBlank extends null | undefined>({
  blank,
  fieldName,
}: {
  blank: TBlank;
  fieldName?: string;
}) {
  return numericFieldText
    .superRefine((value, ctx) => {
      // Unreadable text is rejected here rather than passed on as NaN. A builder
      // that can yield NaN puts the burden on every call site to pipe a bound,
      // and a site that forgets stores NaN in the column.
      if (!isBlank(value) && Number.isNaN(Number(value))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: fieldName
            ? `${fieldName} must be a number`
            : "This field must be a number",
        });
      }
    })
    .transform((value) => coerceOrBlank(value, blank));
}

/**
 * A numeric field the operator must fill in.
 *
 * Rejects a blank field BEFORE coercing, which is the only point at which it can
 * be rejected: afterwards an omitted field and a deliberate zero are both `0`.
 * Zero therefore passes, because "required" means a value was given, not that the
 * value is non-zero.
 *
 * @param options.fieldName - Named in the message, so the operator is told which
 *   field to fill in rather than being handed a type error.
 * @returns A schema yielding `number`.
 *
 * @example
 * maxOrganizations: requiredNumberFromString({ fieldName: "Max organizations" }),
 */
export function requiredNumberFromString({
  fieldName,
}: {
  fieldName?: string;
} = {}) {
  return numericFieldText
    .superRefine((value, ctx) => {
      if (isBlank(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: fieldName
            ? `${fieldName} is required`
            : "This field is required",
        });
        return;
      }

      // Named here for the same reason the blank case is: this builder rejects
      // before any bound piped after it runs, so leaving unreadable text to
      // `z.coerce.number()` would answer "Expected number, received nan" and
      // shadow the field's own message.
      if (Number.isNaN(Number(value))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: fieldName
            ? `${fieldName} must be a number`
            : "This field must be a number",
        });
      }
    })
    .pipe(z.coerce.number());
}
