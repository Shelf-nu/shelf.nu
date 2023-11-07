import { useLocation, useRouteError } from "@remix-run/react";
import { NODE_ENV } from "~/utils/env";
import { isShelfStackError } from "~/utils/error";
import { Button } from "../shared";

export const ErrorContent = () => {
  const location = useLocation();
  const response = useRouteError();
  let title = "Oops, something went wrong";
  let message =
    "An error has occured. Please refresh the page and try again. If the issue persists, please contact support.";

  if (isShelfStackError(response)) {
    title = response?.title || title;
    message = response.message;
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <img src="/images/error-icon.svg" alt={title} className="mb-5" />
        <h2 className="mb-2">{title}</h2>
        <p className="max-w-[550px]">
          {NODE_ENV === "production"
            ? "A server error has occured. Try refreshing the page. If the issue persists please get in touch with support."
            : message}
        </p>

        <div className=" mt-8 flex gap-3">
          <Button to="/" variant="secondary" icon="home">
            Back to home
          </Button>
          <Button to={location.pathname} reloadDocument>
            Reload page
          </Button>
        </div>
      </div>
    </div>
  );
};
