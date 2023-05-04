import { CuboidIcon } from "~/components/icons";
import { Button } from "~/components/shared";

export default function QrNotLoggedIn() {
  return (
    <>
      <div className="flex flex-1 justify-center py-8">
        <div className="my-auto">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary">
            <CuboidIcon />
          </div>
          <div className="mb-8">
            <h1 className="mb-2 text-[24px] font-semibold">
              Thank you for Scanning
            </h1>
            <p>
              Log in if you own this item. Contact the owner to report it found
              if it's lost.
            </p>
          </div>
          <div className="flex flex-col">
          <Button variant="primary" className="mb-4" to={"/login"}>
            Log In
          </Button>
          <Button variant="secondary" to={"."}>
            Contact Owner
          </Button>
          </div>
        </div>
      </div>
      <div className="mt-6 text-center text-sm text-gray-500">
        Don't have an account?{" "}
        <Button
          variant="link"
          data-test-id="signupButton"
          to={{
            pathname: "/join",
          }}
        >
          Sign up
        </Button>
      </div>
    </>
  );
}
