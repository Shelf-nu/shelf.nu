import { Button } from "../shared/button";

export function UpgradeMessage() {
  return (
    <>
      Please consider{" "}
      <Button
        to="/account-details/subscription"
        variant="link"
        className="!m-0 !p-0"
      >
        upgrading
      </Button>{" "}
      your subscription to access this feature.
    </>
  );
}
