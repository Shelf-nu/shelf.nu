const en = {
  login: {
    title: "Log in",
    subHeading: "Welcome back! Enter your details below to log in.",
    acceptedInvite:
      "Successfully accepted workspace invite. Please login to see your new workspace.",
    passwordReset:
      "Password reset successfully.  You can now use your new password to login.",
    forgotPassword: "Don't remember your password?",
    resetPassword: "Reset password",
    continueWithSSO: "Continue with SSO",
    otp1: "Or use a ",
    otp2: "One Time Password",
    otpTitle:
      "One Time Password (OTP) is the most secure way to login. We will send you a code to your email.",
    continueOTP: "Continue with OTP",
    sendingOTP: "Sending you a one time password...",
    noAccount: "Don't have an account?",
    signup: "Sign up",
  },
  register: {
    continueOTP: "Sign up with OTP",
  },
};
export default en;

export type AuthTranslations = typeof en;
