import { sbDb } from "~/database/supabase.server";

import type { ErrorLabel } from "~/utils/error";
import { ShelfError, maybeUniqueConstraintViolation } from "~/utils/error";
import { getRandomColor } from "~/utils/get-random-color";
import { ALL_SELECTED_KEY } from "~/utils/list";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Category";

export async function createCategory({
  name,
  description,
  color,
  userId,
  organizationId,
}: {
  name: string;
  description: string | null;
  color: string;
  userId: string;
  organizationId: string;
}) {
  try {
    const { data, error } = await sbDb
      .from("Category")
      .insert({
        name: name.trim(),
        description,
        color,
        userId,
        organizationId,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Category", {
      additionalData: { userId, organizationId },
    });
  }
}

export async function getCategories(params: {
  organizationId: string;
  /** Page number. Starts at 1 */
  page?: number;
  /** Items to be loaded per page */
  perPage?: number;
  search?: string | null;
}) {
  const { organizationId, page = 1, perPage = 8, search } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8;

    let query = sbDb
      .from("Category")
      .select("*, Asset(count)", { count: "exact" })
      .eq("organizationId", organizationId)
      .order("updatedAt", { ascending: false })
      .range(skip, skip + take - 1);

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const { data, count: totalCategories, error } = await query;

    if (error) throw error;

    // Transform the response to match the previous Prisma shape:
    // { ...category, _count: { assets: N } }
    const categories = (data ?? []).map((row) => {
      const { Asset, ...rest } = row as Record<string, unknown> & {
        Asset: { count: number }[];
      };
      return {
        ...rest,
        _count: { assets: Asset?.[0]?.count ?? 0 },
      };
    });

    return { categories, totalCategories: totalCategories ?? 0 };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the categories",
      additionalData: { ...params },
      label,
    });
  }
}

export async function deleteCategory({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}) {
  try {
    const { error, count } = await sbDb
      .from("Category")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("organizationId", organizationId);

    if (error) throw error;
    return { count };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while deleting the category. Please try again or contact support.",
      additionalData: { id, organizationId },
      label,
    });
  }
}

export async function createCategoriesIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: string;
  organizationId: string;
}): Promise<Record<string, string>> {
  try {
    // first we get all the categories from the assets and make them into a Map
    const categories = new Map(
      data
        .filter((asset) => asset.category)
        .map((asset) => [asset.category, ""])
    );

    // now we loop through the categories and check if they exist
    for (const [category] of categories) {
      const trimmedCategory = (category as string).trim();
      const { data: existingCategory } = await sbDb
        .from("Category")
        .select("id")
        .ilike("name", trimmedCategory)
        .eq("organizationId", organizationId)
        .maybeSingle();

      if (!existingCategory) {
        // if the category doesn't exist, we create a new one
        const { data: newCategory, error } = await sbDb
          .from("Category")
          .insert({
            name: trimmedCategory,
            color: getRandomColor(),
            userId,
            organizationId,
          })
          .select("id")
          .single();

        if (error) throw error;
        categories.set(category, newCategory.id);
      } else {
        // if the category exists, we just update the id
        categories.set(category, existingCategory.id);
      }
    }

    return Object.fromEntries(Array.from(categories));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating categories. Seems like some of the category data in your import file is invalid. Please check and try again.",
      additionalData: { userId, organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
    });
  }
}

export async function getCategory({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}) {
  try {
    const { data, error } = await sbDb
      .from("Category")
      .select("*")
      .eq("id", id)
      .eq("organizationId", organizationId)
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Category not found",
      message:
        "The category you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { id, organizationId },
      label,
    });
  }
}

export async function updateCategory({
  id,
  organizationId,
  name,
  description,
  color,
}: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  color: string;
}) {
  try {
    const { data, error } = await sbDb
      .from("Category")
      .update({
        name: name?.trim(),
        description,
        color,
      })
      .eq("id", id)
      .eq("organizationId", organizationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Category", {
      additionalData: { id, organizationId, name },
    });
  }
}

export async function bulkDeleteCategories({
  categoryIds,
  organizationId,
}: {
  categoryIds: string[];
  organizationId: string;
}) {
  try {
    let query = sbDb
      .from("Category")
      .delete({ count: "exact" })
      .eq("organizationId", organizationId);

    if (!categoryIds.includes(ALL_SELECTED_KEY)) {
      query = query.in("id", categoryIds);
    }

    const { error, count } = await query;

    if (error) throw error;
    return { count };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk deleting categories.",
      additionalData: { categoryIds, organizationId },
      label,
    });
  }
}
