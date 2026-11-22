/**
 * Route tests for a deployment that turned email login off
 * (`DISABLE_EMAIL_LOGIN`): the login page shows only single sign-on, and the
 * password form, every one-time code, the password reset and the password
 * signup are refused when posted anyway.
 *
 * @see apps/webapp/app/routes/_auth+/login.tsx
 * @see apps/webapp/app/routes/_auth+/send-otp.tsx
 * @see apps/webapp/app/routes/_auth+/forgot-password.tsx
 * @see apps/webapp/app/routes/_auth+/join.tsx
 * @see apps/webapp/app/modules/auth/email-login.server.ts
 */
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: importing the routes pulls the Prisma client transitively; a refused
// request reads no database.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: email login is switched per test, independent of DISABLE_EMAIL_LOGIN in
// the local environment.
const loginConfig = vi.hoisted(() => ({
  disableSSO: true,
  disableSignup: true,
  disableEmailLogin: true,
  oidc: { enabled: true, buttonLabel: "Log in with Acme" },
}));
vi.mock("~/config/shelf.config", () => ({ config: loginConfig }));

// why: these call Supabase Auth; a refused request must never reach them.
vi.mock("~/modules/auth/service.server", () => ({
  signInWithEmail: vi.fn(),
  sendOTP: vi.fn(),
  sendResetPasswordLink: vi.fn(),
  updateAccountPassword: vi.fn(),
  signUpWithEmailPass: vi.fn(),
}));

const loginRoute = await import("~/routes/_auth+/login");
const sendOtpRoute = await import("~/routes/_auth+/send-otp");
const forgotPasswordRoute = await import("~/routes/_auth+/forgot-password");
const joinRoute = await import("~/routes/_auth+/join");
const {
  signInWithEmail,
  sendOTP,
  sendResetPasswordLink,
  updateAccountPassword,
  signUpWithEmailPass,
} = await import("~/modules/auth/service.server");

/**
 * Builds a form POST.
 *
 * @param path - the route path
 * @param fields - the form fields
 */
function formPost(path: string, fields: Record<string, string>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

/** Renders the login page with what its loader reports for the config. */
function renderLogin() {
  const Stub = createRoutesStub([
    {
      path: "/login",
      Component: loginRoute.default,
      loader: () => ({
        title: "Log in",
        subHeading: "",
        disableSignup: loginConfig.disableSignup,
        disableSSO: loginConfig.disableSSO,
        disableEmailLogin: loginConfig.disableEmailLogin,
        oidc: loginConfig.oidc,
      }),
    },
  ]);
  render(<Stub initialEntries={["/login"]} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  loginConfig.disableEmailLogin = true;
  loginConfig.disableSignup = true;
});

describe("login page", () => {
  it("shows only the single sign-on button while email login is off", async () => {
    renderLogin();

    const link = await screen.findByRole("link", { name: "Log in with Acme" });
    expect(link).toHaveAttribute("href", "/oidc-login");
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.queryByText("Reset password")).not.toBeInTheDocument();
    expect(screen.queryByText("One Time Password")).not.toBeInTheDocument();
  });

  it("keeps the password form next to the button otherwise", async () => {
    loginConfig.disableEmailLogin = false;
    renderLogin();

    await screen.findByRole("link", { name: "Log in with Acme" });
    expect(screen.getAllByLabelText("Email address").length).toBeGreaterThan(0);
    expect(screen.getByText("One Time Password")).toBeInTheDocument();
  });
});

describe("POST /login", () => {
  it("refuses a password sign-in while email login is off", async () => {
    const result = await loginRoute.action(
      createActionArgs({
        request: formPost("/login", {
          email: "jane@example.com",
          password: "correct horse battery",
        }),
      })
    );

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(signInWithEmail).not.toHaveBeenCalled();
  });
});

describe("POST /send-otp", () => {
  it("refuses a login code while email login is off", async () => {
    const result = await sendOtpRoute.action(
      createActionArgs({
        request: formPost("/send-otp", {
          email: "jane@example.com",
          mode: "login",
        }),
      })
    );

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(sendOTP).not.toHaveBeenCalled();
  });

  it("refuses a signup code too, which would open an account that cannot sign in", async () => {
    const result = await sendOtpRoute.action(
      createActionArgs({
        request: formPost("/send-otp", {
          email: "jane@example.com",
          mode: "signup",
        }),
      })
    );

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(sendOTP).not.toHaveBeenCalled();
  });

  it("refuses a request that names no mode, which asks for a login code", async () => {
    const result = await sendOtpRoute.action(
      createActionArgs({
        request: formPost("/send-otp", { email: "jane@example.com" }),
      })
    );

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(sendOTP).not.toHaveBeenCalled();
  });
});

describe("POST /forgot-password", () => {
  it("refuses to send a reset code while email login is off", async () => {
    const result = await forgotPasswordRoute.action(
      createActionArgs({
        request: formPost("/forgot-password", {
          intent: "request-otp",
          email: "jane@example.com",
        }),
      })
    );

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(sendResetPasswordLink).not.toHaveBeenCalled();
  });

  it("refuses to set a password with a reset code issued earlier", async () => {
    const result = await forgotPasswordRoute.action(
      createActionArgs({
        request: formPost("/forgot-password", {
          intent: "confirm-otp",
          email: "jane@example.com",
          otp: "123456",
          password: "correct horse battery",
          confirmPassword: "correct horse battery",
        }),
      })
    );

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(updateAccountPassword).not.toHaveBeenCalled();
  });
});

describe("POST /join", () => {
  it("refuses a password signup while email login is off, even with signup open", async () => {
    loginConfig.disableSignup = false;

    const result = await joinRoute.action(
      createActionArgs({
        request: formPost("/join", {
          email: "jane@example.com",
          password: "correct horse battery",
          confirmPassword: "correct horse battery",
        }),
      })
    );

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(signUpWithEmailPass).not.toHaveBeenCalled();
  });
});
