import { USER_EMAIL, USER_ID, ORGANIZATION_ID } from "@mocks/user";

import { verifyOtpAndSignin } from "~/modules/auth/service.server";
import {
  getSelectedOrganization,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import { createUser, findUserByEmail } from "~/modules/user/service.server";
import { generateUniqueUsername } from "~/modules/user/utils.server";
import { detectFormatPrefsFromHints } from "~/utils/date-format";

import { action } from "./otp";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: exercise the OTP signup action without hitting Supabase/Prisma; we only
// assert the format-pref detection is wired into the createUser call.
vitest.mock("~/modules/auth/service.server", () => ({
  verifyOtpAndSignin: vitest.fn(),
}));
vitest.mock("~/modules/user/service.server", () => ({
  createUser: vitest.fn(),
  findUserByEmail: vitest.fn(),
}));
vitest.mock("~/modules/user/utils.server", () => ({
  generateUniqueUsername: vitest.fn(),
}));
vitest.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vitest.fn(),
  setSelectedOrganizationIdCookie: vitest.fn(),
}));
// why: importing the otp route transitively loads ~/database/db.server, whose
// module-level `void db.$connect()` rejects with P1001 in a DB-less test env and
// surfaces as an unhandled rejection. The action reaches db only through the
// already-mocked services, so a bare stub is sufficient.
vitest.mock("~/database/db.server", () => ({ db: {} }));
// why: keep the pure detector real elsewhere but pin its output so the assertion
// is deterministic regardless of the host ICU/locale data.
vitest.mock("~/utils/date-format", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, detectFormatPrefsFromHints: vitest.fn() };
});

const username = `test-user-${USER_ID}`;
const DETECTED = {
  dateFormat: "YYYY_MM_DD",
  timeFormat: "H24",
  weekStart: "MONDAY",
  timeZone: "Asia/Tokyo",
} as const;

describe("otp action — format pref detection", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // @ts-expect-error missing vitest type
    verifyOtpAndSignin.mockResolvedValue({
      userId: USER_ID,
      email: USER_EMAIL,
    });
    // @ts-expect-error missing vitest type — user does not exist yet → signup branch
    findUserByEmail.mockResolvedValue(null);
    // @ts-expect-error missing vitest type
    generateUniqueUsername.mockResolvedValue(username);
    // @ts-expect-error missing vitest type
    createUser.mockResolvedValue({ id: USER_ID });
    // @ts-expect-error missing vitest type
    getSelectedOrganization.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
    });
    // @ts-expect-error missing vitest type
    setSelectedOrganizationIdCookie.mockResolvedValue("org-cookie");
    // @ts-expect-error missing vitest type
    detectFormatPrefsFromHints.mockReturnValue(DETECTED);
  });

  it("detects prefs from the request and passes them to createUser on signup", async () => {
    const formData = new FormData();
    formData.append("email", USER_EMAIL);
    formData.append("otp", "123456");

    const request = new Request("http://localhost/otp", {
      method: "POST",
      headers: { "accept-language": "ja-JP" },
      body: formData,
    });
    const context = { isAuthenticated: false, setSession: vitest.fn() };

    await action({ request, context, params: {} } as any);

    expect(detectFormatPrefsFromHints).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ formatPrefs: DETECTED })
    );
  });
});
