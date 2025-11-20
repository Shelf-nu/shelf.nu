import type { LoadUserForNotesFn } from "~/modules/note/load-user-for-notes.server";
import type { Category, Currency, Prisma, User } from "@prisma/client";

import { formatCurrency } from "~/utils/currency";
import {
  wrapDescriptionForNote,
  wrapLinkForNote,
  wrapTextDiffForNote,
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

  const tag = wrapDescriptionForNote(
    normalizedPrevious ?? undefined,
    normalizedNext ?? undefined
  );

  return `${userLink} updated the description ${tag}.`;
}

/**
 * Build the name change Markdoc snippet via text_diff tag.
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

  if (normalizedPrevious === normalizedNext) {
    return null;
  }

  const diffTag = wrapTextDiffForNote(normalizedPrevious, normalizedNext, "Name");
  return `${userLink} updated the asset name. ${diffTag}`;
}

/**
 * Convert a category into a link / bold text for notes.
 */
export function formatCategoryForNote(category?: Pick<Category, "id" | "name"> | null) {
  if (!category) {
    return null;
  }

  const name = (category.name ?? "Unnamed category").trim();
  if (!name) {
    return null;
  }

  return category.id ? wrapLinkForNote(`/categories/${category.id}`, name) : `**${name}**`;
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
  previous?: Pick<Category, "id" | "name"> | null;
  next?: Pick<Category, "id" | "name"> | null;
}) {
  const formattedPrevious = formatCategoryForNote(previous);
  const formattedNext = formatCategoryForNote(next);

  if (formattedPrevious === formattedNext) {
    return null;
  }

  if (formattedPrevious && formattedNext) {
    return `${userLink} changed the category from ${formattedPrevious} to ${formattedNext}.`;
  }

  if (formattedNext) {
    return `${userLink} set the category to ${formattedNext}.`;
  }

  return `${userLink} removed the category.`;
}

/**
 * Convert Prisma decimal / number into number.
 */
export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object" && value !== null && "toNumber" in value) {
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
    return `${userLink} changed the valuation from ${formattedPrevious} to ${formattedNext}.`;
  }

  if (formattedNext) {
    return `${userLink} set the valuation to ${formattedNext}.`;
  }

  return `${userLink} removed the valuation.`;
}
