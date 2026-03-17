import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Location";

type CreateLocationNoteArgs = {
  content: string;
  locationId: string;
  type?: Sb.NoteType;
  userId?: string | null;
};

export async function createLocationNote({
  content,
  type = "COMMENT",
  locationId,
  userId,
}: CreateLocationNoteArgs) {
  try {
    const { data, error } = await sbDb
      .from("LocationNote")
      .insert({
        content,
        type,
        locationId,
        ...(userId ? { userId } : {}),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating the location note.",
      additionalData: { locationId, userId },
      label,
    });
  }
}

export async function createSystemLocationNote({
  content,
  locationId,
  userId,
}: {
  content: string;
  locationId: string;
  userId?: string;
}) {
  try {
    const { data, error } = await sbDb
      .from("LocationNote")
      .insert({
        content,
        type: "UPDATE",
        locationId,
        ...(userId ? { userId } : {}),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating the location update.",
      additionalData: { locationId },
      label,
    });
  }
}

export async function getLocationNotes({
  locationId,
  organizationId,
}: {
  locationId: string;
  organizationId: string;
}) {
  try {
    const { data: location } = await sbDb
      .from("Location")
      .select("id")
      .eq("id", locationId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (!location) {
      throw new ShelfError({
        cause: null,
        message: "Location not found or access denied",
        additionalData: { locationId, organizationId },
        label,
        status: 404,
      });
    }

    const { data, error } = await sbDb
      .from("LocationNote")
      .select("*, user:User(firstName, lastName)")
      .eq("locationId", locationId)
      .order("createdAt", { ascending: false });

    if (error) throw error;
    return data ?? [];
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the location notes.",
      additionalData: { locationId, organizationId },
      label,
    });
  }
}

export async function deleteLocationNote({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    const { error, count } = await sbDb
      .from("LocationNote")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("userId", userId);

    if (error) throw error;
    return { count };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the location note.",
      additionalData: { id, userId },
      label,
    });
  }
}

export type LocationNoteWithUser = Sb.LocationNoteRow & {
  user: { firstName: string | null; lastName: string | null } | null;
};
