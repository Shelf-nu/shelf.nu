import type { Category, Currency, Prisma, User } from "@prisma/client";
import type { LoadUserForNotesFn } from "~/modules/note/load-user-for-notes.server";

import { formatCurrency } from "~/utils/currency";
import {
  wrapCategoryForNote,
  wrapDescriptionForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";

/**
 * Resolve the user link for activity notes from the memoized loader.
 */
export async function resolveUserLink({
  userId,
  loadUserForNotes,
}: {
  userId: User["id"];
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const user = await loadUserForNotes();
  return wrapUserLinkForNote({
    id: userId,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
  });
}

/**
 * Normalize optional text from database / form input.
 */
export function normalizeText(value?: string | null) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build the description change Markdoc snippet.
 */
export function buildDescriptionChangeNote({
  userLink,
  previous,
  next,
}: {
  userLink: string;
  previous?: string | null;
  next?: string | null;
}) {
  const normalizedPrevious = normalizeText(previous);
  const normalizedNext = normalizeText(next);

  if (normalizedPrevious === normalizedNext) {
    return null;
  }

  if (!normalizedPrevious && normalizedNext) {
    const tag = wrapDescriptionForNote(undefined, normalizedNext);
    return `${userLink} added an asset description ${tag}.`;
  }

  if (normalizedPrevious && !normalizedNext) {
    const tag = wrapDescriptionForNote(normalizedPrevious, undefined);
    return `${userLink} removed the asset description ${tag}.`;
  }

  const tag = wrapDescriptionForNote(normalizedPrevious, normalizedNext);
  return `${userLink} updated the asset description ${tag}.`;
}

/**
 * Build the name change note using inline bold formatting.
 */
export function buildNameChangeNote({
  userLink,
  previous,
  next,
}: {
  userLink: string;
  previous?: string | null;
  next?: string | null;
}) {
  const normalizedPrevious = normalizeText(previous);
  const normalizedNext = normalizeText(next);

  if (!normalizedPrevious || !normalizedNext) {
    return null;
  }

  if (normalizedPrevious === normalizedNext) {
    return null;
  }

  const formatName = (value: string) => {
    const escaped = value.replace(/([*_`~])/g, "\\$1");
    return `**${escaped}**`;
  };

  return `${userLink} updated the asset name from ${formatName(
    normalizedPrevious
  )} to ${formatName(normalizedNext)}.`;
}

/**
 * Convert a category into a link / bold text for notes.
 */
export function formatCategoryForNote(
  category?: Pick<Category, "id" | "name" | "color"> | null
) {
  if (!category) {
    return null;
  }

  const name = (category.name ?? "Unnamed category").trim();
  if (!name) {
    return null;
  }

  return wrapCategoryForNote(category);
}

/**
 * Build the category change note content.
 */
export function buildCategoryChangeNote({
  userLink,
  previous,
  next,
}: {
  userLink: string;
  previous?: Pick<Category, "id" | "name" | "color"> | null;
  next?: Pick<Category, "id" | "name" | "color"> | null;
}) {
  // Check for null before formatting since wrapCategoryForNote always returns a string
  const hasPrevious = previous != null;
  const hasNext = next != null;

  // No change if both are null or both point to the same category
  if (!hasPrevious && !hasNext) {
    return null;
  }

  if (hasPrevious && hasNext && previous.id === next.id) {
    return null;
  }

  const formattedPrevious = wrapCategoryForNote(previous);
  const formattedNext = wrapCategoryForNote(next);

  // Both categories exist - it's a change from one to another
  if (hasPrevious && hasNext) {
    return `${userLink} changed the asset category from ${formattedPrevious} to ${formattedNext}.`;
  }

  // Only next exists - setting category for the first time
  if (hasNext) {
    return `${userLink} set the asset category to ${formattedNext}.`;
  }

  // Only previous exists - removing the category
  return `${userLink} removed the asset category.`;
}

/**
 * Convert Prisma decimal / number into number.
 */
export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as Prisma.Decimal).toNumber === "function"
  ) {
    try {
      return (value as Prisma.Decimal).toNumber();
    } catch {
      return null;
    }
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Format valuation as currency for notes.
 */
export function formatCurrencyForNote({
  value,
  currency,
  locale,
}: {
  value: number | null;
  currency: Currency;
  locale: string;
}) {
  if (value === null) {
    return null;
  }

  return formatCurrency({
    value,
    currency,
    locale,
  });
}

/**
 * Build the valuation change note body.
 */
export function buildValuationChangeNote({
  userLink,
  previous,
  next,
  currency,
  locale,
}: {
  userLink: string;
  previous?: Prisma.Decimal | number | null;
  next?: Prisma.Decimal | number | null;
  currency: Currency;
  locale: string;
}) {
  const previousNumeric = toNullableNumber(previous);
  const nextNumeric = toNullableNumber(next);

  if (previousNumeric === nextNumeric) {
    return null;
  }

  const formattedPrevious = formatCurrencyForNote({
    value: previousNumeric,
    currency,
    locale,
  });
  const formattedNext = formatCurrencyForNote({
    value: nextNumeric,
    currency,
    locale,
  });

  if (formattedPrevious && formattedNext) {
    return `${userLink} changed the asset value from ${formattedPrevious} to ${formattedNext}.`;
  }

  if (formattedNext) {
    return `${userLink} set the asset value to ${formattedNext}.`;
  }

  return `${userLink} removed the asset value.`;
}
