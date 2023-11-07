import { useRouteError } from "@remix-run/react";
import { isShelfStackError } from "~/utils/error";

export const ErrorContent = () => {
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
        <p className="max-w-[550px]">{message}</p>

        <div className=" mt-8 flex gap-3"></div>
      </div>
    </div>
  );
};
