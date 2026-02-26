import { test as base } from "@playwright/test";
import nodemailer from "nodemailer";
import { faker } from "@faker-js/faker";
import { expect } from "@playwright/test";

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
      const password = testAccount.pass;
      const firstName = faker.name.firstName();
      const lastName = faker.name.lastName();

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
      // await page.fill("#magic-link", email);

      await page.click("[data-test-id=continueWithOTPButton]");

      await expect(page.getByText("Check your emails")).toBeVisible();

      /** We are waiting to make sure the email arrives */
      await page.waitForTimeout(10000);

      await page.goto("https://ethereal.email/login");

      await page.fill("#address", email);
      await page.fill("#password", password);
      await page.getByRole("button", { name: "Log in" }).click();

      await page.getByRole("link", { name: "Messages" }).click();
      await page.getByRole("link", { name: "Your Magic Link" }).click();

      const text = await page.innerText("#plaintext");
      const regex = /\[([^\]]+)\]/;
      const matches = text.match(regex);
      let confirmUrl = "";
      if (matches && matches.length > 0) {
        confirmUrl = matches[1];
      }

      await page.goto(confirmUrl);

      // Wait for the field to be present on the DOM before filling it
      await page.waitForSelector('[data-test-id="firstName"]');

      await page.fill('[data-test-id="firstName"]', firstName);
      await page.fill('[data-test-id="lastName"]', lastName);
      await page.fill('[data-test-id="password"]', password);
      await page.fill('[data-test-id="confirmPassword"]', password); // We use the same password that nodemailer generated for the email account

      await page.locator('[data-test-id="onboard"]').click();
      await expect(page).toHaveURL(/.*assets/);
      await expect(page.getByText("No assets on database")).toBeVisible();
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
