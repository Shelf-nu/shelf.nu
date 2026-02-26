import type { AssetForPreview, AssetForThumbnail } from "./types";

// Type guard functions to help with type checking
export function hasMainImage(asset: {
  mainImage?: unknown;
}): asset is { mainImage: string } {
  return (
    typeof "mainImage" in asset &&
    asset.mainImage === "string" &&
    asset.mainImage.length > 0
  );
}

export function hasPreviewData(asset: unknown): asset is AssetForPreview {
  return (
    typeof asset === "object" &&
    asset !== null &&
    "id" in asset &&
    "mainImage" in asset &&
    "mainImageExpiration" in asset
  );
}

// A utility to check if an asset is already of the preview type
export function isAssetForPreview(
  asset: AssetForThumbnail | AssetForPreview
): asset is AssetForPreview {
  return "mainImage" in asset && "mainImageExpiration" in asset;
}

/**
 * Consistent utility for extracting storage paths from Supabase URLs
 * This consolidates the logic from both refresh functions
 */
export function extractStoragePath(
  url: string,
  bucketName: string
): string | null {
  if (!url) return null;

  // Direct path handling - doesn't need URL parsing
  // Check if it's a simple path without http/https
  if (!url.includes("://") && !url.startsWith("/storage")) {
    // If it starts with the bucket name, remove it
    if (url.startsWith(`${bucketName}/`)) {
      return url.substring(bucketName.length + 1);
    }
    // Otherwise return the path as is
    return url;
  }

  try {
    // Try parsing as a URL
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;

    // Handle signed URLs (format: /storage/v1/object/sign/bucket/path?token=...)
    if (pathname.includes("/object/sign/")) {
      const signMatch = pathname.match(`/object/sign/${bucketName}/(.+)`);
      if (signMatch && signMatch[1]) {
        return signMatch[1];
      }
    }

    // Handle public URLs (format: /storage/v1/object/public/bucket/path)
    if (pathname.includes("/object/public/")) {
      const publicMatch = pathname.match(`/object/public/${bucketName}/(.+)`);
      if (publicMatch && publicMatch[1]) {
        return publicMatch[1];
      }
    }

    // Handle authenticated URLs (format: /storage/v1/object/authenticated/bucket/path)
    if (pathname.includes("/object/authenticated/")) {
      const authMatch = pathname.match(
        `/object/authenticated/${bucketName}/(.+)`
      );
      if (authMatch && authMatch[1]) {
        return authMatch[1];
      }
    }

    // Fallback: try to find bucket name anywhere in the path
    const parts = pathname.split("/");
    const bucketIndex = parts.indexOf(bucketName);
    if (bucketIndex !== -1 && bucketIndex < parts.length - 1) {
      return parts.slice(bucketIndex + 1).join("/");
    }

    // Additional fallback: check if the URL pathname might be the path itself
    if (!pathname.startsWith("/storage") && !pathname.includes("supabase")) {
      return pathname.startsWith("/") ? pathname.substring(1) : pathname;
    }

    // Check the token payload for URL information - sometimes the path is stored there
    const token = parsedUrl.searchParams.get("token");
    if (token) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          // Base64 decode in a browser-compatible way
          const payload = JSON.parse(atob(parts[1]));
          if (payload.url && typeof payload.url === "string") {
            const urlPath = payload.url;
            // If the URL in the token starts with the bucket name, remove it
            if (urlPath.startsWith(`${bucketName}/`)) {
              return urlPath.substring(bucketName.length + 1);
            }
            return urlPath;
          }
        }
      } catch (_tokenError) {
        // Ignore token parsing errors
      }
    }

    return null;
  } catch (_e) {
    // If URL parsing fails, treat it as a direct path
    if (url.startsWith(`${bucketName}/`)) {
      return url.substring(bucketName.length + 1);
    }
    return url;
  }
}
