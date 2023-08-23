

# Shelf.nu  

<h4 align="center">
✨ Open Source Asset Management Infrastructure for everyone. ✨
</h4>
<p align="center" >
Shelf 🏷️ Asset Management infrastructure for absolutely everyone (open source).<br/>
Shelf is a simple and visual asset management and location tracking system that allows people to track their physical assets with ease.
</p>

## Core Features and Benefits 💫

With Shelf, you can take a picture of any item you own and store it in your own database. From there, you can generate a printable code (QR) that you can tag onto the item, making it easy to identify and locate in the future. Shelf has a handy code printing area where you can add as many QR codes as you can on an A4 sticker paper sheet. You can also add detailed information about the item, including its purchase date, purchase price, warranty information, and more.

<div align="center">

[![Shelf.nu Discord](https://dcbadge.vercel.app/api/server/fjBugmvzZP)](https://discord.gg/BZ6ATKK2)

<p align="center">
    <a href="https://www.shelf.nu/"><b>Website</b></a> •
    <a href=""><b>Documentation</b></a> •
    <a href="https://discord.gg/BZ6ATKK2"><b>Chat with us</b></a> • 
    <a href="https://twitter.com/ShelfQR"><b>Twitter</b></a>
</p>

### Once your assets are online, you will be able to:

- Generate printable PDFs sheets from assets you select, so you can stick them onto anything
- Check the last known location of your assets
- Instant Search through your assets database
- Use 'lost mode' for emergencies (offer a bounty for a return of an item)
- Get notified of assets you are not using
- Share your asset vault with other users

### Use Shelf alone, or as a team. And, these questions will be a thing of the past.

- Who was the last person that took X,Y or Z?
- What gear does X have currently?
- Which assets did we appoint to our team member abroad?
- What do we have in our storage facility now?

## Shelf's vision and ambition

To enable and facilitate the tagging of 1 Billion assets by 2023. Shelf therefore allows users to create unlimited assets on their environments. We will fund the growth and further development of the tool by releasing premium features. However, Shelf core will be forever free for individuals.

---

### Shelf's current stack

We have decided to give RemixJS a try.

For the purpose of shipping asap, we have opted into using a template: https://github.com/rphlmr/supa-fly-stack

### Getting started with Shelf

# Remix Supa Fly Stack

> This Readme will be re-written soon

```
npx create-remix --template rphlmr/supa-fly-stack
```

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

Not a fan of bits of the stack? Fork it, change it, and use `npx create-remix --template your/repo`! Make it your own.

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
  fly apps create supa-fly-stack-template-staging  # ** not mandatory if you don't want a staging environnement **
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

### Asssets

1. Create a bucket called `assets`
2. Implement a policy for `SELECT`, `INSERT`, `UPDATE` & `DELETE`. The policy expression is: `((bucket_id = 'assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))` and target roles should be set to `authenticated`

## GitHub Actions

> DISCLAIMER : Github actions ==> I'm not an expert about that. Read carefully before using it

We use GitHub Actions for continuous integration and deployment. Anything that gets into the `main` branch will be deployed to production after running tests/build/etc. Anything in the `dev` branch will be deployed to staging.

👉 **You have to add some env secrets for playwright.** 👈

Add a `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`,`SUPABASE_ANON_PUBLIC`, `SERVER_URL` and `DATABASE_URL` to [your repo secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
Please make sure that the `SERVER_URL` is set to `"http://localhost:3000"`. This will ensure that the magic link works when running playwright tests during Github actions.

## Testing

### Playwright

We use Playwright for our End-to-End tests in this project. You'll find those in the `test` directory. As you make changes, add to an existing file or create a new file in the `test/e2e` directory to test your changes. If you want to add extra fixtures, you can add them in the fixtures directory.

To run these tests in development, complete your `.env` and run `npm run test:e2e:dev` which will start the dev server for the app as well as the Playwright client. Make sure the database is running in docker as described above.

NOTE: We currently don't have a utility to delete users created by the tests so you will have to delete those manually for now. We will at some point create a utility that runs after all tests and deltes the user that was created during the test.

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
To do that navigate to Authentication > URL configiration and add the folowing values:

- https://localhost:3000/oauth/callback
- https://localhost:3000/reset-password

- https://staging-domain.com/oauth/callback
- https://staging-domain.com/reset-password

- https://live-domain.com/oauth/callback
- https://live-domain.com/reset-password


[![Last commit](https://img.shields.io/github/last-commit/rowyio/rowy/rc)](https://github.com/rowyio/rowy/commits/rc)
[![GitHub stars](https://img.shields.io/github/stars/rowyio/rowy)](https://github.com/rowyio/rowy/stargazers/)

</div>

## Live Demo 🛝

💥 Explore Rowy on [live demo playground](https://demo.rowy.io/) 💥

## Features ✨

<!-- <table>
    <tr>
    <th>
      <a href="#">Database</a>
    </th>
    <th>
      <a href="#">Automation</a>
    </th>
    </tr>
    <tr>
    <td>
        <a href="#">
        <img src=""/>
    </a>
    </td>
    <td>
        <a href="#">
        <img src=""/>
    </a>
    </td>
    </tr>
</table> -->
https://user-images.githubusercontent.com/307298/157185793-f67511cd-7b7b-4229-9589-d7defbf7a63f.mp4

<!-- <img width="85%" src="https://firebasestorage.googleapis.com/v0/b/rowyio.appspot.com/o/publicDemo%2FRowy%20Website%20Video%20GIF%20Small.gif?alt=media&token=3f699a8f-c1f2-4046-8ed5-e4ff66947cd8" />
 -->

### Powerful spreadsheet interface for Firestore

- CMS for Firestore
- CRUD operations
- Bulk import or export data - csv, json, tsv
- Sort and filter by row values
- Lock, Freeze, Resize, Hide and Rename columns
- Multiple views for the same collection

### Automate with cloud functions and ready made extensions

- Build cloud functions workflows on field level data changes
  - Use any NPM modules or APIs
- Connect to your favourite tool with pre-built code blocks or create your own
  - SendGrid, Algolia, Twilio, Bigquery and more

### Rich and flexible data fields

- [30+ fields supported](https://docs.rowy.io/field-types/supported-fields)
  - Basic types: Short Text, Long Text, Email, Phone, URL…
  - Custom UI pickers: Date, Checkbox, Single Select, Multi Select…
  - Uploaders: Image, File
  - Rich Editors: JSON, Code, Rich Text (HTML), Markdown
- Data validation, default values, required fields
- Action field: Clickable trigger for any Cloud Function
- Aggregate field: Populate cell with value aggregated from the row’s sub-table
- Connector field: Connect data from multiple table collections
- Connect Service: Get data from any HTTP endpoint

### Collaborate with your team

- Granular table-level and field-level permission control  
  with role based access controls
- Built in user management
- Customizable views for different user roles

## Quick guided install

Set up Rowy on your Google Cloud Platform project with this easy deploy button. Your
data and cloud functions stay on your own Firestore/GCP and is managed via a cloud run instance that operates exclusively on your GCP project. So we do do not access or store any of your data on Rowy.

[<img width="200" alt="Guided quick start button" src="https://user-images.githubusercontent.com/307298/185548050-e9208fb6-fe53-4c84-bbfa-53c08e03c15f.png">](https://rowy.app/)

https://rowy.app

## Documentation

You can find the full documentation with how-to guides and templates
[here](http://docs.rowy.io/).

## Manual Install

We recommend the [quick guided install](https://github.com/rowyio/rowy#quick-guided-install) option above. Manual install option is only recommended if you want to develop and contribute to the project. Follow this [guide](https://docs.rowy.io/setup/install#option-2-manual-install) for manual setup.

## Roadmap

[View our roadmap](https://roadmap.rowy.io/) on Rowy - Upvote,
downvote, share your thoughts!

If you'd like to propose a feature, submit an issue
[here](https://github.com/rowyio/rowy/issues/new?assignees=&labels=&template=feature_request.md&title=).

## Support the project

- Join a community of developers on [Discord](https://discord.gg/fjBugmvzZP) and
  share your ideas/feedback 💬
- Follow us on [Twitter](https://twitter.com/rowyio) and help
  [spread the word](https://twitter.com/intent/tweet?text=Check%20out%20@rowyio%20-%20It%27s%20like%20an%20open-source%20Airtable%20for%20your%20database,%20but%20with%20a%20built-in%20code%20editor%20for%20cloud%20functions%20to%20run%20on%20data%20CRUD!%0a%0aEsp%20if%20building%20on%20@googlecloud%20and%20@Firebase%20stack,%20it%20is%20the%20fastest%20way%20to%20build%20your%20product.%20Live%20demo:%20https://demo.rowy.io)
  🙏
- Give us a star to this Github repo ⭐️
- Submit a PR. Take a look at our
  [contribution guide](https://github.com/rowyio/rowy/blob/main/CONTRIBUTING.md)
  and get started with
  [good first issues](https://github.com/rowyio/rowy/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

## Help

- Live chat support on [Discord](https://www.rowy.io/discord)
- [Email](mailto:hello@rowy.io)