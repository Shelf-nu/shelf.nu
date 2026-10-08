/**
 * Builds the form the SSO callback pages post: only the refresh token and where
 * to land. Groups, names and contact info are deliberately not sent: the server
 * reads them from the SSO identity itself (`getSsoClaimsForAuthUser`) rather
 * than from anything the browser posts.
 *
 * @param refreshToken - the refresh token Supabase put in the URL fragment
 * @param redirectTo - where to land after sign-in (unused on mobile)
 * @returns the form data to post to the callback action
 */
export function createSSOFormData(
  refreshToken: string,
  redirectTo: string
): FormData {
  const formData = new FormData();
  formData.append("refreshToken", refreshToken);
  formData.append("redirectTo", redirectTo);
  return formData;
}
