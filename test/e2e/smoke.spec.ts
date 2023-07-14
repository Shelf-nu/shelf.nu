import { faker } from "@faker-js/faker";
import { test, expect } from "../fixtures/account";
import nodemailer from "nodemailer";

/** To use console log while testing you need to use the following snippet:
 * ```
 *  await page.evaluate((confirmUrl) => {
      console.log(confirmUrl);
    }, confirmUrl);
    ```
 */
test("should allow you to register and login", async ({ page, account }) => {
  page.on("console", (message) => {
    console.log(`[Page Console] ${message.text()}`);
  });

  // await page.evaluate((account) => {
  //   console.log(account);
  // }, account);

  await page.evaluate((account) => {
    console.log(account.password);
  }, account);

  // Set up the console event listener

  await page.goto("/");
  await page.click("[data-test-id=signupButton]");
  await expect(page).toHaveURL(/.*join/);
  await page.fill("#magic-link", account.email);

  await page.click("[data-test-id=continueWithMagicLink]");

  await expect(page.getByText("Check your emails")).toBeVisible();

  await page.goto("https://ethereal.email/login");

  await page.fill("#address", account.email);
  await page.fill("#password", account.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForTimeout(1000);

  await page.getByRole("link", { name: "Messages" }).click();
  await page.getByRole("link", { name: "Confirm Your Signup" }).click();
  const text = await page.innerText("#plaintext");
  const regex = /\[([^\]]+)\]/;
  const matches = text.match(regex);
  let confirmUrl = "";
  if (matches && matches.length > 0) {
    confirmUrl = matches[1];
  }

  await page.goto(confirmUrl);
  await page.waitForTimeout(2000);

  /** Fill in onboarding form */
  await page.fill('[data-test-id="firstName"]', account.firstName);
  await page.fill('[data-test-id="lastName"]', account.lastName);
  await page.fill('[data-test-id="password"]', account.password);
  await page.fill('[data-test-id="confirmPassword"]', account.password); // We use the same password that nodemailer generated for the email account

  await page.locator('[data-test-id="onboard"]').click();
  await expect(page).toHaveURL(/.*assets/);
  await expect(page.getByText("No assets on database")).toBeVisible();
  await page.click('[data-test-id="logout"]');
  await expect(page).toHaveURL(/.*login/);
});

test("should allow you to make a asset", async ({ page, account }) => {
  page.on("console", (message) => {
    console.log(`[Page Console] ${message.text()}`);
  });

  await page.evaluate((account) => {
    console.log(account.password);
  }, account);

  const testAsset = {
    title: faker.lorem.words(2),
    description: faker.lorem.sentences(1),
  };
  await page.goto("/");

  await page.fill('[data-test-id="email"]', account.email);
  await page.fill('[data-test-id="password"]', account.password);
  await page.click('[data-test-id="login"]');

  await expect(page).toHaveURL(/.*assets/);

  await page.click('[data-test-id="createNewAsset"]');
  await expect(page).toHaveURL(/.*assets\/new/);
  const focusedElement = await page.$(":focus");
  expect(await focusedElement?.getAttribute("name")).toBe("title");
  await page.getByLabel("Name").fill(testAsset.title);
  await page.getByLabel("Description").fill(testAsset.description);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(300);
  page.getByRole("heading", { name: testAsset.title });
  await page.click('[data-test-id="closeToast"]');

  await page.click('[data-test-id="logout"]');
  await expect(page).toHaveURL(/.*login/);
});

test("should allow you to make a category", async ({ page, account }) => {
  const testCategory = {
    title: faker.lorem.words(2),
    description: faker.lorem.sentences(1),
  };

  await page.goto("/");

  await page.fill('[data-test-id="email"]', account.email);
  await page.fill('[data-test-id="password"]', account.password);
  await page.click('[data-test-id="login"]');

  await expect(page).toHaveURL(/.*assets/);

  /** create category */
  await page.click('[data-test-id="categoriesSidebarMenuItem"]');
  await page.click('[data-test-id="createNewCategory"]');
  await expect(page).toHaveURL(/.*categories\/new/);
  const focusedElementCat = await page.$(":focus");
  expect(await focusedElementCat?.getAttribute("name")).toBe("name");
  await page
    .getByPlaceholder("Category name", { exact: true })
    .fill(testCategory.title);
  await page.getByLabel("Description").fill(testCategory.description);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(300);

  await expect(page.getByText(testCategory.title)).toBeVisible();

  await page.click('[data-test-id="closeToast"]');

  await page.click('[data-test-id="logout"]');
  await expect(page).toHaveURL(/.*login/);
});
