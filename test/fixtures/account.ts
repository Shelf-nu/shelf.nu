import { test as base } from "@playwright/test";
import nodemailer from "nodemailer";
import { faker } from "@faker-js/faker";

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

      // Use the account value.
      await use({ email, password, firstName, lastName });
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
