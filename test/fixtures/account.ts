import { test as base } from "@playwright/test";
import nodemailer from "nodemailer";
import { faker } from "@faker-js/faker";
import { expect } from "@playwright/test";
import { generateRandomCode } from "~/modules/invite/helpers";

type Account = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
};

// Note that we pass worker fixture types as a second template parameter.
export const test = base.extend<{}, { account: Account }>({
  account: [
    async ({ browser }, use, workerInfo) => {
      // Unique username.
      const testAccount = await nodemailer.createTestAccount();
      const email = testAccount.user;
      const password = "1234qwer";
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();

      const page = await browser.newPage();

      // page.on("console", (message) => {
      //   console.log(`[Page Console] ${message.text()}`);
      // });

      // await page.evaluate((email) => {
      //   console.log(email);
      // }, email);
      // await page.evaluate((password) => {
      //   console.log(password);
      // }, password);

      await page.goto("/");
      await page.click("[data-test-id=signupButton]");
      await expect(page).toHaveURL(/.*join/);
      await page.fill("[data-test-id=email]", email);
      await page.fill("[data-test-id=password]", password);
      await page.fill("[data-test-id=confirmPassword]", password);

      await page.click("[data-test-id=login]");

      await expect(page.getByText("Confirm your email")).toBeVisible();

      await page.fill("[data-test-id=otp]", "123456");
      await page.click("[data-test-id=confirm-otp]");

      await expect(page).toHaveURL(/.*onboarding/);

      await page.fill('[data-test-id="firstName"]', firstName);
      await page.fill('[data-test-id="lastName"]', lastName);

      await page.click('[data-test-id="onboard"]');

      await page.waitForSelector('[data-test-id="choose-purpose-wrapper"]');
      await expect(page.getByText("How will you use shelf?")).toBeVisible();

      await page.click("[data-test-id=personal-plan]");
      await page.click("[data-test-id=next-button]");

      await expect(page.getByText("Untitled Asset")).toBeVisible();
      await expect(page).toHaveURL(/.*assets\/new/);

      await page.click('[data-test-id="user-actions-dropdown"]');
      await page.click('[data-test-id="logout"]');
      await expect(page).toHaveURL(/.*login/);

      // Use the account value.
      await use({ email, password, firstName, lastName });
    },
    { scope: "worker", timeout: 60000 },
  ],
  page: async ({ page, account }, use) => {
    // Sign in with our account.
    const { email, password } = account;
    await page.goto("/");

    await page.fill('[data-test-id="email"]', email);
    await page.fill('[data-test-id="password"]', password);
    await page.click('[data-test-id="login"]');
    await expect(page).toHaveURL(/.*assets/);

    // Use signed-in page in the test.
    await use(page);
  },
});

export { expect };
