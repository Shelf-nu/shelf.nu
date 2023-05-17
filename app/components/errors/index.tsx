import { isRouteErrorResponse, useRouteError } from "@remix-run/react";
import { ErrorContent } from "./content";

export const ErrorBoundryComponent = () => {
  const error = useRouteError();

  /** 404 ERROR */
  if (isRouteErrorResponse(error))
    return (
      <ErrorContent
        title="Sorry, this page doesnt exist"
        message="It may have been (re)moved or the URL you’ve entered is incorrect."
      />
    );

  /** 500 error */
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  return (
    <ErrorContent
      title="Oops, something went wrong"
      message={errorMessage}
      error={error}
    />
  );
};
