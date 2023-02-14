import { faker } from "@faker-js/faker";

describe("smoke tests", () => {
  afterEach(() => {
    cy.cleanupUser();
  });

  it("should allow you to register and login", () => {
    const loginForm = {
      email: faker.internet
        .email(undefined, undefined, "example.com")
        .toLowerCase(),
      password: faker.internet.password(),
    };
    cy.then(() => ({ email: loginForm.email })).as("user");

    cy.visit("/");
    cy.findByTestId("join").click();

    cy.findByTestId("email").type(loginForm.email);
    cy.findByTestId("password").type(loginForm.password);
    cy.findByTestId("create-account").click();

    cy.findByText("No notes yet");

    cy.findByTestId("logout").click();
    cy.findByTestId("login");
  });

  it("should allow you to make a note", () => {
    const testNote = {
      title: faker.lorem.words(1),
      body: faker.lorem.sentences(1),
    };
    const credentials = {
      email: faker.internet
        .email(undefined, undefined, "example.com")
        .toLowerCase(),
      password: faker.internet.password(),
    };

    cy.log("Create account with", credentials);
    cy.createAccount(credentials);
    cy.visit("/");
    cy.findByTestId("login").click();

    cy.findByTestId("email").type(credentials.email);
    cy.findByTestId("password").type(credentials.password);
    cy.findByTestId("login").click();

    cy.findByText("No notes yet");

    cy.findByRole("link", { name: /\+ new note/i }).click();

    cy.findByRole("textbox", { name: /title/i }).type(testNote.title);
    cy.findByRole("textbox", { name: /body/i }).type(testNote.body);
    cy.findByRole("button", { name: /save/i }).click();

    cy.findByRole("button", { name: /delete/i }).click();

    cy.findByText("No notes yet");
    cy.findByTestId("logout").click();
    cy.findByTestId("login");
  });
});
