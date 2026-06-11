import { redirect, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getParams } from "~/utils/http.server";

/**
 * Splat route to handle requests with data after userId in the url.
 * This is mostly made for handling users cmd+click on asset or booking in user page.
 *
 * Extracts the splat segment from the request URL and redirects to the
 * reconstructed local path, preserving the query string and hash. Only
 * same-origin relative paths are allowed; protocol-relative (`//`) or otherwise
 * non-local targets are rejected to prevent open redirects.
 *
 * @param args - Loader arguments containing the incoming `request` and route `params`.
 * @returns A redirect `Response` pointing to the validated relative path.
 * @throws {Response} 400 response when the resolved redirect target is not a safe local path.
 */
export const loader = ({ request, params }: LoaderFunctionArgs) => {
  const { "*": splat } = getParams(
    params,
    z.object({ userId: z.string(), "*": z.string() })
  );
  const url = new URL(request.url);
  const redirectTo = `/${splat}${url.search}${url.hash}`;

  if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) {
    throw new Response("Invalid redirect", { status: 400 });
  }

  return redirect(redirectTo);
};
