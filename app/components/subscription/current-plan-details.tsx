import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/account-details.subscription";
import { Button } from "../shared/button";

export const CurrentPlanDetails = () => {
  const { activeProduct, expiration, subscription, isTrialSubscription } =
    useLoaderData<typeof loader>();

  return (
    <div>
      <p>
        You’re currently using the <b>{activeProduct?.name}</b> version of Shelf{" "}
        {isTrialSubscription ? " on a free trial" : ""}.
      </p>

      <div>
        {subscription?.canceled_at ? (
          <>
            <p>
              Your plan has been canceled and will be active until{" "}
              <b>{expiration.date}</b> at <b>{expiration.time}</b>.
            </p>
            <p>You can renew it at any time by going to the customer portal.</p>
          </>
        ) : (
          <p>
            {!isTrialSubscription ? (
              <>
                {" "}
                Your subscription renews on <b>{expiration.date}</b> at{" "}
                <b>{expiration.time}</b>
              </>
            ) : (
              <>
                {" "}
                Your{" "}
                <Button
                  to="https://www.shelf.nu/knowledge-base/free-trial"
                  target="_blank"
                  variant="link"
                >
                  free trial
                </Button>{" "}
                expires on <b>{expiration.date}</b> at <b>{expiration.time}</b>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
};
