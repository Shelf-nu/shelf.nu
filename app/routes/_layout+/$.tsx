import { ErrorBoundryComponent } from "~/components/errors";

export const loader = () => {
  throw new Response("Not Found", { status: 404 });
};

/** This route is meant for handling 404 errors for logged in users  */
export default function LayoutSplat() {
  return null;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
