import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = ({ context }: LoaderFunctionArgs) => {
  if (context.isAuthenticated) {
    return redirect("/assets");
  }

  return redirect("/login");
};

export default function Route() {
  return null;
}
