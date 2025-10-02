import { describe, expect, it } from "vitest";

import { SUPPORT_EMAIL } from "~/utils/env";
import {
  changeEmailAddressHtmlEmail,
  changeEmailAddressTextEmail,
} from "./change-user-email-address";

describe("changeEmailAddress emails", () => {
  const user = {
    firstName: "Alex",
    lastName: "Stone",
    email: "alex@example.com",
  };
  const otp = "123456";

  it("includes the emphasized OTP and safety guidance in the text email", () => {
    expect(
      changeEmailAddressTextEmail({
        otp,
        user,
      })
    ).toEqual(
      `Howdy Alex Stone,\n\nYour email change verification code: **${otp}**\n\nDon't share this with anyone. This code expires in 1 hour.\n\nIf you didn't request this, ignore this email and contact ${SUPPORT_EMAIL}.\n\nThanks,\nThe Shelf Team`
    );
  });

  it("renders the HTML email with the OTP in the title and body", () => {
    const html = changeEmailAddressHtmlEmail(otp, user);

    expect(html).toContain(`<title>🔐 Verification code: ${otp}</title>`);
    expect(html).toContain(`<b>${otp}</b>`);
  });
});
