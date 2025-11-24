import type React from "react";
import SubHeading from "~/components/shared/sub-heading";

export type OtpVerifyMode = "login" | "signup" | "confirm_signup";

export type OtpPageData = Record<
  OtpVerifyMode,
  {
    title: string;
    SubHeading: React.FC<{ email: string }>;
    buttonTitle: string;
  }
>;

export const OTP_PAGE_MAP: OtpPageData = {
  login: {
    title: "Fill your code",
    SubHeading: ({ email }) => (
      <SubHeading className="-mt-4 text-center">
        We have sent a code to{" "}
        <span className="font-bold text-gray-900">{email}</span>. Fill the code
        below to log in.
      </SubHeading>
    ),
    buttonTitle: "Log In",
  },
  signup: {
    title: "Create an account",
    SubHeading: () => (
      <SubHeading className="-mt-4 text-center">
        Start your journey with Shelf.
      </SubHeading>
    ),
    buttonTitle: "Create Account",
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
  },
};

export const DEFAULT_PAGE_DATA: OtpPageData["login"] = {
  title: "One Time Password",
  buttonTitle: "Continue",
  SubHeading: () => (
    <SubHeading className="-mt-4 text-center">
      Please confirm your OTP to continue
    </SubHeading>
  ),
};

export function getOtpPageData(mode: OtpVerifyMode) {
  return OTP_PAGE_MAP[mode] ?? DEFAULT_PAGE_DATA;
}
