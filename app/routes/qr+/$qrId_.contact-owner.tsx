import type { ActionArgs } from "@remix-run/node";
import { atom, useAtom } from "jotai";
import Input from "~/components/forms/input";
import { SuccessIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils";

export const action = async ({ request }: ActionArgs) => {
  return null;
};

const successfulSubmissionAtom = atom(false);

export default function ContactOwner() {
  const [successfulSubmission, setSuccessfulSubmission] = useAtom(
    successfulSubmissionAtom
  );
  return (
    <>
      <div className="flex-1 py-8">
        <div className="mb-8">
          <h1 className="mb-2 text-[24px] font-semibold">Contact Owner</h1>
          <p className="text-gray-600">
            Assist the owner by sharing your contact information.
          </p>
        </div>
        <form
          action="#"
          className={tw("text-left", successfulSubmission ? "hidden" : "")}
        >
          <Input
            label="Email"
            className="mb-3"
            type="email"
            autoComplete="email"
            required
          />
          <div className="mb-8">
            <Input label="Message" inputType="textarea" />
            <p className="mt-2.5 text-center text-gray-600">
              By leaving your contact information you agree that the owner of
              the asset can contact you.
            </p>
          </div>
          <Button width="full" onClick={() => setSuccessfulSubmission(true)}>
            Send
          </Button>
        </form>
        <div
          className={tw(
            "rounded-xl border border-solid border-success-300 bg-success-25 p-4 text-center leading-[1]",
            successfulSubmission ? "block" : "hidden"
          )}
        >
          <p className="inline-flex items-center gap-2 font-semibold leading-[1] text-success-700">
            <SuccessIcon />
            Your message has been sent
          </p>
        </div>
      </div>
    </>
  );
}
