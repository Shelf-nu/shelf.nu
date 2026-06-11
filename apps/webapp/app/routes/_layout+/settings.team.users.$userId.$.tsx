import { redirect, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getParams } from "~/utils/http.server";

/**
 * Splat route to handle requests with data after userId in the url
 * This is mostly made for handling users cmd+click on asset or booking in user page
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
