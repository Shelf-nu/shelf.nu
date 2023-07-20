import { faker } from "@faker-js/faker";
import { test, expect } from "../fixtures/account";

/** To use console log while testing you need to use the following snippet:
 * ```
 *  await page.evaluate((confirmUrl) => {
      console.log(confirmUrl);
    }, confirmUrl);
    ```
 */

test("should allow you to make a asset", async ({ page, account }) => {
  page.on("console", (message) => {
    console.log(`[Page Console] ${message.text()}`);
  });

  const testAsset = {
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

  await expect(page.getByText(testCategory.title)).toBeVisible();

  await page.click('[data-test-id="closeToast"]');

  await page.click('[data-test-id="logout"]');
  await expect(page).toHaveURL(/.*login/);
});

test("should allow you to add team member", async ({ page, account }) => {
  // const testCategory = {
  //   title: faker.lorem.words(2),
  //   description: faker.lorem.sentences(1),
  // };
  // /** create category */
  // await page.click('[data-test-id="categoriesSidebarMenuItem"]');
  // await page.click('[data-test-id="createNewCategory"]');
  // await expect(page).toHaveURL(/.*categories\/new/);
  // const focusedElementCat = await page.$(":focus");
  // expect(await focusedElementCat?.getAttribute("name")).toBe("name");
  // await page
  //   .getByPlaceholder("Category name", { exact: true })
  //   .fill(testCategory.title);
  // await page.getByLabel("Description").fill(testCategory.description);
  // await page.getByRole("button", { name: "Create" }).click();
  // await expect(page.getByText(testCategory.title)).toBeVisible();
  // await page.click('[data-test-id="closeToast"]');
  // await page.click('[data-test-id="logout"]');
  // await expect(page).toHaveURL(/.*login/);
});
