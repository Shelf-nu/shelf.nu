import { faker } from "@faker-js/faker";
import { test, expect } from "@playwright/test";
import nodemailer from "nodemailer";

test.beforeEach(async ({ page }) => {
  const testAccount = await nodemailer.createTestAccount();

  const onboardingForm = {
    firstName: faker.name.firstName(),
    lastName: faker.name.lastName(),
    password: faker.internet.password(),
  };

  // Set up the console event listener
  // page.on("console", (message) => {
  //   console.log(`[Page Console] ${message.text()}`);
  // });
  await page.goto("/");
  await page.click("[data-test-id=signupButton]");
  await expect(page).toHaveURL(/.*join/);
  await page.fill("#magic-link", testAccount.user);

  await page.click("[data-test-id=continueWithMagicLink]");

  await expect(page.getByText("Check your emails")).toBeVisible();

  await page.goto("https://ethereal.email/login");

  await page.fill("#address", testAccount.user);
  await page.fill("#password", testAccount.pass);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForTimeout(1000);

  await page.getByRole("link", { name: "Messages" }).click();
  await page.getByRole("link", { name: "Confirm Your Signup" }).click();
  const text = await page.innerText("#plaintext");
  const regex = /https:\/\/.*\/oauth\/callback/;
  const matches = text.match(regex);
  let confirmUrl = "";
  if (matches && matches.length > 0) {
    confirmUrl = matches[0];
  }

  await page.goto(confirmUrl);
  await page.waitForTimeout(2000);

  /** Fill in onboarding form */
  await page.fill('[data-test-id="firstName"]', onboardingForm.firstName);
  await page.fill('[data-test-id="lastName"]', onboardingForm.lastName);
  await page.fill('[data-test-id="password"]', onboardingForm.password);
  await page.fill('[data-test-id="confirmPassword"]', onboardingForm.password);

  await page.locator('[data-test-id="onboard"]').click();
});

test("should allow you to register and login", async ({ page }) => {
  await expect(page).toHaveURL(/.*assets/);
  await expect(page.getByText("No assets on database")).toBeVisible();
  await page.click('[data-test-id="logout"]');
  await expect(page).toHaveURL(/.*login/);
});

test("should allow you to make a asset and category", async ({ page }) => {
  const testAsset = {
    title: faker.lorem.words(2),
    description: faker.lorem.sentences(1),
  };
  const testCategory = {
    title: faker.lorem.words(2),
    description: faker.lorem.sentences(1),
  };

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

  await page.click('[data-test-id="closeToast"]');
  await page.click('[data-test-id="logout"]');
  await expect(page).toHaveURL(/.*login/);
});
