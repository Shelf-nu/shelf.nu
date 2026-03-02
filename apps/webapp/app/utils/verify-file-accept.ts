/**
 * Check if a mime type matches the set given in accept
 *
 * @param type the mime type to test, ex image/png
 * @param accept the mime types to accept, ex audio/*,video/*,image/png
 * @returns true if the mime is accepted, false otherwise
 */
export function verifyAccept(type: string, accept: string): boolean {
  const allowed = accept.split(",").map((x) => x.trim());
  return allowed.includes(type) || allowed.includes(type.split("/")[0] + "/*");
}
