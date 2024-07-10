import { json } from "@remix-run/node";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

export async function loader() {
  try {
    const query = await fetch("https://formbricks.com/api/oss-friends");
    const response = await query.json();

    return json(response, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}
