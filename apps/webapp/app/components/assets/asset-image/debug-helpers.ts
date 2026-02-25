/* eslint-disable no-console */
/**
 * Utility functions to help debug JWT tokens and image URLs
 * Add this to your project temporarily to help diagnose issues
 */

/**
 * Decodes a JWT token and returns the payload
 */
export function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Base64 decode the payload
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (e) {
    console.error("Failed to decode JWT:", e);
    return null;
  }
}

/**
 * Extracts the JWT token from a Supabase signed URL
 */
export function extractJwtFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.searchParams.get("token");
  } catch (e) {
    console.error("Failed to extract JWT from URL:", e);
    return null;
  }
}

/**
 * Analyzes an image URL to help with debugging
 */
export function analyzeImageUrl(url: string): {
  isSupabaseUrl: boolean;
  isSigned: boolean;
  bucketName: string | null;
  path: string | null;
  tokenInfo: Record<string, any> | null;
  expirationDate: Date | null;
} {
  const result = {
    isSupabaseUrl: false,
    isSigned: false,
    bucketName: null as string | null,
    path: null as string | null,
    tokenInfo: null as Record<string, any> | null,
    expirationDate: null as Date | null,
  };

  // Check if it's a Supabase URL
  result.isSupabaseUrl = url.includes("supabase.co");

  if (!result.isSupabaseUrl) {
    return result;
  }

  try {
    const parsedUrl = new URL(url);

    // Check if it's a signed URL
    result.isSigned = parsedUrl.pathname.includes("/object/sign/");

    // Try to extract bucket name
    const pathParts = parsedUrl.pathname.split("/");
    if (result.isSigned && pathParts.length >= 5) {
      result.bucketName = pathParts[4];
    }

    // Extract path - everything after the bucket name
    if (result.bucketName && pathParts.length > 5) {
      result.path = pathParts.slice(5).join("/");
    }

    // Extract and decode token
    const token = parsedUrl.searchParams.get("token");
    if (token) {
      result.tokenInfo = decodeJwt(token);

      // Extract expiration
      if (result.tokenInfo && typeof result.tokenInfo.exp === "number") {
        result.expirationDate = new Date(result.tokenInfo.exp * 1000);
      }
    }
  } catch (e) {
    console.error("Error analyzing URL:", e);
  }

  return result;
}

/**
 * Use this function in your component to debug image loading issues
 */
export function debugImageUrl(url: string): void {
  console.group("Image URL Debug Information");
  console.log("URL:", url);

  const analysis = analyzeImageUrl(url);
  console.log("Is Supabase URL:", analysis.isSupabaseUrl);
  console.log("Is Signed URL:", analysis.isSigned);
  console.log("Bucket:", analysis.bucketName);
  console.log("Path:", analysis.path);

  if (analysis.tokenInfo) {
    console.log("Token Payload:", analysis.tokenInfo);

    if (analysis.expirationDate) {
      console.log("Token Expires:", analysis.expirationDate.toLocaleString());
      const now = new Date();
      console.log("Is Expired:", now > analysis.expirationDate);

      if (now < analysis.expirationDate) {
        const timeRemaining = Math.floor(
          (analysis.expirationDate.getTime() - now.getTime()) / 1000
        );
        console.log("Seconds Until Expiration:", timeRemaining);
      }
    }
  }

  console.groupEnd();
}
