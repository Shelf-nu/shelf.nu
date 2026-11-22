import type { FC } from "react";
import SubHeading from "~/components/shared/sub-heading";

export type OtpVerifyMode = "login" | "signup" | "confirm_signup";

export type OtpPageData = Record<
  OtpVerifyMode,
  {
    title: string;
    SubHeading: FC<{ email: string }>;
    buttonTitle: string;
    /** Notice shown after "Send again" succeeds. */
    resentMessage: string;
  }
>;

/** The resend notice for modes where a code always goes out. */
const CODE_RESENT = "Email sent successfully. Please check your inbox.";

/**
 * The resend notice for modes whose send answers the same for every address,
 * so it cannot claim a code went out.
 */
const CODE_MAYBE_RESENT =
  "If this address can receive a code, a new one is on its way. Please check your inbox.";

export const OTP_PAGE_MAP: OtpPageData = {
  login: {
    title: "Fill your code",
    // The send answers the same for every address, so this cannot claim a
    // code went out: an address with no account here, or one that must use
    // SSO, is sent nothing.
    SubHeading: ({ email }) => (
      <SubHeading className="-mt-4 text-center">
        If <span className="font-bold text-gray-900">{email}</span> can sign in
        with a code, we have sent one to it. Fill the code below to log in.
      </SubHeading>
    ),
    buttonTitle: "Log In",
    resentMessage: CODE_MAYBE_RESENT,
  },
  signup: {
    title: "Create an account",
    SubHeading: () => (
      <SubHeading className="-mt-4 text-center">
        Start your journey with Shelf.
      </SubHeading>
    ),
    buttonTitle: "Create Account",
    resentMessage: CODE_RESENT,
  },
  confirm_signup: {
    title: "Confirm your email",
    SubHeading: ({ email }) => (
      <SubHeading className="-mt-4 text-center">
        We have sent a code to{" "}
        <span className="font-bold text-gray-900">{email}</span>. Fill the code
        below to confirm you email.
      </SubHeading>
    ),
    buttonTitle: "Confirm",
    resentMessage: CODE_RESENT,
  },
};

export const DEFAULT_PAGE_DATA: OtpPageData["login"] = {
  title: "One Time Password",
  buttonTitle: "Continue",
  resentMessage: CODE_MAYBE_RESENT,
  SubHeading: () => (
    <SubHeading className="-mt-4 text-center">
      Please confirm your OTP to continue
    </SubHeading>
  ),
};

export function getOtpPageData(mode: OtpVerifyMode) {
  return OTP_PAGE_MAP[mode] ?? DEFAULT_PAGE_DATA;
}
