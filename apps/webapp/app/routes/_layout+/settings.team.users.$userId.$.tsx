import { redirect, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getParams, safeRedirect } from "~/utils/http.server";

/**
 * Splat route to handle requests with data after userId in the url.
 * This is mostly made for handling users cmd+click on asset or booking in user page.
 *
 * Reconstructs the target from the splat segment (preserving query string and
 * hash) and routes it through `safeRedirect`, the canonical guard that resolves
 * the destination and falls back to "/" for anything that is not same-origin —
 * closing open-redirect vectors like `//host`, `/\host` and `%5C`-decoded
 * backslashes.
 *
 * @param args - Loader arguments containing the incoming `request` and route `params`.
 * @returns A redirect `Response` to the validated same-origin path.
 */
export const loader = ({ request, params }: LoaderFunctionArgs) => {
  const { "*": splat } = getParams(
    params,
    z.object({ userId: z.string(), "*": z.string() })
  );
  const url = new URL(request.url);

  return redirect(safeRedirect(`/${splat}${url.search}${url.hash}`));
};
