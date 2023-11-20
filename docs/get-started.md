### Shelf's current stack

We have decided to give RemixJS a try.

For the purpose of shipping asap, we have opted into using a template: https://github.com/rphlmr/supa-fly-stack

## What's in the stack

- [Fly app deployment](https://fly.io) with [Docker](https://www.docker.com/products/docker-desktop/)
- Production-ready [Supabase Database](https://supabase.com/)
- Healthcheck endpoint for [Fly backups region fallbacks](https://fly.io/docs/reference/configuration/#services-http_checks)
- [GitHub Actions](https://github.com/features/actions) to deploy on merge to production and staging environments
- Email/Password Authentication / Magic Link, with [cookie-based sessions](https://remix.run/docs/en/v1/api/remix#createcookiesessionstorage)
- Database ORM with [Prisma](https://prisma.io)
- Forms Schema (client and server sides !) validation with [Remix Params Helper](https://github.com/kiliman/remix-params-helper)
- Styling with [Tailwind](https://tailwindcss.com/)
- End-to-end testing with [Playwright](https://playwright.dev/)
- Local third party request mocking with [MSW](https://mswjs.io)
- Unit testing with [Vitest](https://vitest.dev) and [Testing Library](https://testing-library.com)
- Code formatting with [Prettier](https://prettier.io)
- Linting with [ESLint](https://eslint.org)
- Static Types with [TypeScript](https://typescriptlang.org)

## Development

- Create a [Supabase Database](https://supabase.com/) (free tier gives you 2 databases)

  > **Note:** Only one for playing around with Supabase or 2 for `staging` and `production`

  > **Note:** Used all your free tiers ? Also works with [Supabase CLI](https://github.com/supabase/cli) and local self-hosting

  > **Note:** Create a strong database password, but prefer a passphrase, it'll be more easy to use in connection string (no need to escape special char)
  >
  > _example : my_strong_passphrase_

- Go to https://app.supabase.io/project/{PROJECT}/settings/api to find your secrets
- "Project API keys"
- Add your `MAPTILER_TOKEN`, `SUPABASE_URL`, `SERVER_URL`, `SUPABASE_SERVICE_ROLE` (aka `service_role` `secret`), `SUPABASE_ANON_PUBLIC` (aka `anon` `public`) and `DATABASE_URL` in the `.env` file
  > **Note:** `SERVER_URL` is your localhost on dev. It'll work for magic link login

```en
DATABASE_URL="postgres://postgres:{STAGING_POSTGRES_PASSWORD}@db.{STAGING_YOUR_INSTANCE_NAME}.supabase.co:5432/postgres"
SUPABASE_ANON_PUBLIC="{ANON_PUBLIC}"
SUPABASE_SERVICE_ROLE="{SERVICE_ROLE}"
SUPABASE_URL="https://{STAGING_YOUR_INSTANCE_NAME}.supabase.co"
SESSION_SECRET="super-duper-s3cret"
SERVER_URL="http://localhost:3000"
MAPTILER_TOKEN="someToken"
SMTP_HOST="smtp.yourhost.com"
SMTP_USER="you@example.com"
SMTP_PWD="yourSMTPpassword"
```

- This step only applies if you've opted out of having the CLI install dependencies for you:

  ```sh
  npx remix init
  ```

- Initial setup:

  ```sh
  npm run setup
  ```

- Start dev server:

  ```sh
  npm run dev
  ```

This starts your app in development mode, rebuilding assets on file changes.

The database seed script creates a new user with some data you can use to get started:

- Email: `hello@supabase.com`
- Password: `supabase`

### Relevant code:

This is a pretty simple note-taking app, but it's a good example of how you can build a full-stack app with Prisma, Supabase, and Remix. The main functionality is creating users, logging in and out (handling access and refresh tokens + refresh on expiration), and creating and deleting notes.

- auth / session [./app/modules/auth](./app/modules/auth)
- creating, and deleting notes [./app/modules/note](./app/modules/note)

## Deployment

> Do what you know if you are a Fly.io expert.

This Remix Stack comes with two GitHub Actions that handle automatically deploying your app to production and staging environments.

Prior to your first deployment, you'll need to do a few things:

- [Install Fly](https://fly.io/docs/getting-started/installing-flyctl/)

- Sign up and log in to Fly

  ```sh
  fly auth signup
  ```

  > **Note:** If you have more than one Fly account, ensure that you are signed into the same account in the Fly CLI as you are in the browser. In your terminal, run `fly auth whoami` and ensure the email matches the Fly account signed into the browser.

- Create two apps on Fly, one for staging and one for production:

  ```sh
  fly apps create supa-fly-stack-template
  fly apps create supa-fly-stack-template-staging  # ** not mandatory if you don't want a staging environment **
  ```

  > **Note:** For production app, make sure this name matches the `app` set in your `fly.toml` file. Otherwise, you will not be able to deploy.

  - Initialize Empty Git repository.

  ```sh
  git init
  ```

- Create a new [GitHub Repository](https://repo.new), and then add it as the remote for your project. **Do not push your app yet!**

  ```sh
  git remote add origin <ORIGIN_URL>
  ```

- Add `MAPTILER_TOKEN` which is needed for rendering the map which shows the last scanned location. For more info and to get an account and token: https://www.maptiler.com/

- Add a `FLY_API_TOKEN` to your GitHub repo. To do this, go to your user settings on Fly and create a new [token](https://web.fly.io/user/personal_access_tokens/new), then add it to [your repo secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets) with the name `FLY_API_TOKEN`.

- Add a `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`,`SUPABASE_ANON_PUBLIC`, `SERVER_URL` and `DATABASE_URL` to your fly app secrets

  > **Note:** To find your `SERVER_URL`, go to [your fly.io dashboard](https://fly.io/apps/supa-fly-stack-template-3a36)

  To do this you can run the following commands:

  ```sh
  # production (--app name is resolved from fly.toml)
  fly secrets set SESSION_SECRET=$(openssl rand -hex 32)
  fly secrets set SUPABASE_URL="https://{YOUR_INSTANCE_NAME}.supabase.co"
  fly secrets set SUPABASE_SERVICE_ROLE="{SUPABASE_SERVICE_ROLE}"
  fly secrets set SUPABASE_ANON_PUBLIC="{SUPABASE_ANON_PUBLIC}"
  fly secrets set DATABASE_URL="postgres://postgres:{POSTGRES_PASSWORD}@db.{YOUR_INSTANCE_NAME}.supabase.co:5432/postgres"
  fly secrets set SERVER_URL="https://{YOUR_STAGING_SERVEUR_URL}"
  fly secrets set MAPTILER_TOKEN="{YOUR_MAPTILER_TOKEN}"

  fly secrets set SMTP_HOST="smtp.yourhost.com"
  fly secrets set SMTP_USER="you@example.com"
  fly secrets set SMTP_PWD="yourSMTPpassword"


  # staging (specify --app name) ** not mandatory if you don't want a staging environnement **
  fly secrets set SESSION_SECRET=$(openssl rand -hex 32) --app supa-fly-stack-template-staging
  fly secrets set SUPABASE_URL="https://{YOUR_STAGING_INSTANCE_NAME}.supabase.co" --app supa-fly-stack-template-staging
  fly secrets set SUPABASE_SERVICE_ROLE="{STAGING_SUPABASE_SERVICE_ROLE}" --app supa-fly-stack-template-staging
  fly secrets set SUPABASE_ANON_PUBLIC="{STAGING_SUPABASE_ANON_PUBLIC}" --app supa-fly-stack-template-staging
  fly secrets set DATABASE_URL="postgres://postgres:{STAGING_POSTGRES_PASSWORD}@db.{STAGING_YOUR_INSTANCE_NAME}.supabase.co:5432/postgres" --app supa-fly-stack-template-staging
  fly secrets set SERVER_URL="https://{YOUR_STAGING_SERVEUR_URL}" --app supa-fly-stack-template-staging

  ```

  If you don't have openssl installed, you can also use [1password](https://1password.com/generate-password) to generate a random secret, just replace `$(openssl rand -hex 32)` with the generated secret.

Now that everything is set up you can commit and push your changes to your repo. Every commit to your `main` branch will trigger a deployment to your production environment, and every commit to your `dev` branch will trigger a deployment to your staging environment.

> **Note:** To deploy manually, just run `fly deploy` (It'll deploy app defined in fly.toml)

## File Storage

For File storage we use the S3 buckets service provided by supabase. We do this as it makes it easier to manage permissions in relation to our users which are also stored on supabase. To set it up you need to do the following steps:

### Profile pictures

1. Create a bucket called `profile-pictures`
2. Make it a public bucket
3. Implement a policy for `INSERT`, `UPDATE` & `DELETE`. The policy expression is: `((bucket_id = 'profile-pictures'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))` and target roles should be set to `authenticated`

### Assets

1. Create a bucket called `assets`
2. Implement a policy for `SELECT`, `INSERT`, `UPDATE` & `DELETE`. The policy expression is: `((bucket_id = 'assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))` and target roles should be set to `authenticated`

## GitHub Actions

> DISCLAIMER : Github actions ==> I'm not an expert about that. Read carefully before using it

We use GitHub Actions for continuous integration and deployment. Anything that gets into the `main` branch will be deployed to production after running tests/build/etc. Anything in the `dev` branch will be deployed to staging.

👉 **You have to add some env secrets for playwright.** 👈

Add a `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `SUPABASE_ANON_PUBLIC`, `SERVER_URL` and `DATABASE_URL` to [your repo secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
Please make sure that the `SERVER_URL` is set to `"http://localhost:3000"`. This will ensure that the magic link works when running playwright tests during Github actions.

## Testing

### Playwright

We use Playwright for our End-to-End tests in this project. You'll find those in the `test` directory. As you make changes, add to an existing file or create a new file in the `test/e2e` directory to test your changes. If you want to add extra fixtures, you can add them in the fixtures directory.

To run these tests in development, complete your `.env` and run `npm run test:e2e:dev` which will start the dev server for the app as well as the Playwright client. Make sure the database is running in docker as described above.

NOTE: We currently don't have a utility to delete users created by the tests so you will have to delete those manually for now. We will at some point create a utility that runs after all tests and deletes the user that was created during the test.

### Vitest

For lower level tests of utilities and individual components, we use `vitest`. We have DOM-specific assertion helpers via [`@testing-library/jest-dom`](https://testing-library.com/jest-dom).

### Type Checking

This project uses TypeScript. It's recommended to get TypeScript set up for your editor to get a great in-editor experience with type checking and auto-complete. To run type checking across the whole project, run `npm run typecheck`.

### Linting

This project uses ESLint for linting. That is configured in `.eslintrc.js`.

### Formatting

We use [Prettier](https://prettier.io/) for auto-formatting in this project. It's recommended to install an editor plugin (like the [VSCode Prettier plugin](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)) to get auto-formatting on save. There's also a `npm run format` script you can run to format all files in the project.

## Start working with Supabase

You are now ready to go further, congrats!

To extend your Prisma schema and apply changes on your supabase database :

- Make your changes in [./app/database/schema.prisma](./app/database/schema.prisma)
- Prepare your schema migration
  ```sh
  npm run db:prepare-migration
  ```
- Check your migration in [./app/database/migrations](./app/database)
- Apply this migration to production

  ```sh
  npm run db:deploy-migration
  ```

## If your token expires in less than 1 hour (3600 seconds in Supabase Dashboard)

If you have a lower token lifetime than me (1 hour), you should take a look at `REFRESH_ACCESS_TOKEN_THRESHOLD` in [./app/modules/auth/session.server.ts](./app/modules/auth/session.server.ts) and set what you think is the best value for your use case.

## Supabase RLS

You may ask "can I use RLS with Remix".

The answer is "Yes" but It has a cost.

Using Supabase SDK server side to query your database (for those using RLS features) adds an extra delay due to calling a Gotrue rest API instead of directly calling the Postgres database (and this is fine because at first Supabase SDK is for those who don't have/want backend).

In my benchmark, it makes my pages twice slower. (~+200ms compared to a direct query with Prisma)

## Supabase login with magic link

In order to make the register/login with magic link work, you will need to add some configuration to your Supabase.
You need to add the site url as well as the redirect urls of your local, test and live app that will be used for oauth
To do that navigate to Authentication > URL configuration and add the following values:

- https://localhost:3000/oauth/callback
- https://localhost:3000/reset-password

- https://staging-domain.com/oauth/callback
- https://staging-domain.com/reset-password

- https://live-domain.com/oauth/callback
- https://live-domain.com/reset-password

## Premium

Shelf hosted version has some premium features that are locked behind different tiers of subscriptions. By default those features are disabled. To enable them add the env variable:

```
ENABLE_PREMIUM_FEATURES="true"
```
