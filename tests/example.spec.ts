import { test, expect } from "@playwright/test";
import nodemailer from "nodemailer";

test("should allow you to register and login", async ({ page }) => {
  const testAccount = await nodemailer.createTestAccount();

  // Set up the console event listener
  page.on("console", (message) => {
    console.log(`[Page Console] ${message.text()}`);
  });
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
  await page.waitForTimeout(3000);

  await page.getByRole("link", { name: "Messages" }).click();
  await page.getByRole("link", { name: "Confirm Your Signup" }).click();
  await page.getByRole("link", { name: "Source" }).click();
  const emailText = await page.innerText(".numbered");
  const hrefRegex = /href=3D"([^"]+)"/;
  const match = hrefRegex.exec(emailText);
  let hrefValue = "";
  if (match && match.length > 1) {
    hrefValue = decodeURIComponent(match[1]);
  }

  await page.evaluate((hrefValue) => {
    console.log(hrefValue);
  }, hrefValue);
  await page.goto(hrefValue);

  // page.goto(hrefValue);

  // if (hrefMatch && hrefMatch.length >= 2) {
  //   hrefValue = hrefMatch[1];
  // }
  // Use page.evaluate to execute JavaScript code in the page's context

  // const url = await page.getByText(
  //   '<p><a href=3D"https://luouuvatmygcrxkhcxmg.supabase.co/auth/v1/verify?token='
  // );
  // console.log(url);
  // const lastEmail = await testAccount.user.getLastEmail();
  // console.log(lastEmail);

  // Retrieve the intercepted emails from the mock inbox
  // const sentEmails = transport.sentMail();
  // expect(sentEmails.length).toBe(1); // Ensure only one email was sent

  // const email = await readEmail(joinEmail);

  // expect(page).toContain("");

  //  cy.visit("/");
  //  cy.wait(100);
  //  cy.findByTestId("signupButton").click();
  //  cy.wait(300);
  //  cy.findByTestId("email").type(loginForm.email);
  //  cy.findByTestId("password").type(loginForm.password);
  //  cy.findByTestId("create-account").click();
  //  cy.wait(300);
  //  cy.findByText("No assets on database");
  //  cy.findByTestId("logout").click();
  //  cy.findByTestId("login");

  // Expect a title "to contain" a substring.
  // await expect(page).toHaveTitle(/Playwright/);
});
