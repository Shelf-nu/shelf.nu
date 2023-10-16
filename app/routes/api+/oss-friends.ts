import { json } from "@remix-run/node";

export const loader = async () => {
  const query = await fetch("https://formbricks.com/api/oss-friends");
  const response = await query.json();

  return json(response, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=604800",
    },
  });
};
