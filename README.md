<a href="https://www.shelf.nu/" target="_blank">
<img width="100%" src="./apps/webapp/public/static/images/readme-cover.jpg" alt="Shelf.nu" />
</a>

<h3 align="center">Open-source asset management infrastructure for everyone.</h3>

<p align="center">
  <a href="https://github.com/Shelf-nu/shelf.nu/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Shelf-nu/shelf.nu?label=License" alt="License" /></a>
  <a href="https://github.com/Shelf-nu/shelf.nu/actions/workflows/deploy.yml"><img src="https://github.com/Shelf-nu/shelf.nu/actions/workflows/deploy.yml/badge.svg" alt="Deploy" /></a>
  <a href="https://github.com/Shelf-nu/shelf.nu/stargazers"><img src="https://img.shields.io/github/stars/Shelf-nu/shelf.nu" alt="Stars" /></a>
  <a href="https://discord.gg/8he9W7aTJu"><img src="https://img.shields.io/badge/Discord-community-blue?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <a href="https://www.shelf.nu/?ref=github"><b>Website</b></a> &middot;
  <a href="https://docs.shelf.nu/?ref=github"><b>Documentation</b></a> &middot;
  <a href="https://discord.gg/8he9W7aTJu"><b>Discord</b></a> &middot;
  <a href="https://twitter.com/ShelfQR/?ref=github"><b>Twitter</b></a>
</p>

---

Shelf is a platform for tracking physical assets — equipment, devices, tools, vehicles, props, inventory. It's built for teams that need to know what they have, where it is, and who's using it. Organizations use Shelf to manage thousands of assets across locations with role-based access for their teams.

## Features

- **QR asset tags** — Generate and print QR codes. Scan with any phone to view, check out, or report an asset.
- **Bookings and reservations** — Schedule equipment, prevent double-bookings, set checkout/return dates with calendar integration.
- **Custody tracking** — Assign assets to team members. Know who has what at all times.
- **Location management** — Hierarchical locations (buildings, floors, rooms, shelves). GPS tagging support.
- **Team roles** — Owner, Admin, Base, and Self Service roles with granular permissions.
- **Custom fields** — Add any metadata to assets: purchase date, warranty info, serial numbers, condition.
- **Categories and tags** — Organize assets into categories. Tag for flexible cross-cutting grouping.
- **Kits** — Bundle assets into kits (e.g., laptop + charger + dock) and manage them as a unit.
- **Search and filtering** — Full-text search with advanced filters. Saved filter presets.
- **CSV import/export** — Bulk import assets from spreadsheets. Export for reporting.
- **Asset reminders** — Schedule alerts for maintenance, calibration, warranty expiry.
- **Audit trail** — Notes and activity logs on every asset.
- **Multi-workspace** — Manage separate inventories for different organizations or departments.
- **Scanner** — Built-in QR/barcode scanner with bulk actions: assign custody, update location, add to bookings.

## Tech Stack

| Layer      | Technology                                                                      |
| ---------- | ------------------------------------------------------------------------------- |
| Framework  | [React Router](https://reactrouter.com/) 7 (React 19)                           |
| Language   | [TypeScript](https://www.typescriptlang.org/) 5                                 |
| Database   | [PostgreSQL](https://www.postgresql.org/) via [Supabase](https://supabase.com/) |
| ORM        | [Prisma](https://www.prisma.io/) 6                                              |
| Styling    | [Tailwind CSS](https://tailwindcss.com/) 3                                      |
| Components | [Radix UI](https://www.radix-ui.com/) primitives                                |
| Auth       | [Supabase Auth](https://supabase.com/docs/guides/auth) (email, SSO)             |
| Job queue  | [pg-boss](https://github.com/timgit/pg-boss)                                    |
| Payments   | [Stripe](https://stripe.com/)                                                   |
| Email      | [Nodemailer](https://nodemailer.com/) (SMTP)                                    |
| Build      | [Vite](https://vite.dev/) 7, [Turborepo](https://turbo.build/)                  |
| Testing    | [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/)            |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22.20.0
- [pnpm](https://pnpm.io/) >= 9.15.4
- A [Supabase](https://supabase.com/) project (free tier works)

### Setup

```bash
# Clone the repository
git clone https://github.com/Shelf-nu/shelf.nu.git
cd shelf.nu

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env
```

Edit `.env` with your Supabase credentials and other configuration. See the [Supabase setup guide](https://docs.shelf.nu/supabase-setup) for step-by-step instructions.

```bash
# Generate Prisma client and run migrations
pnpm webapp:setup

# Start development server
pnpm webapp:dev
```

The app runs at `https://localhost:3000` (the dev server uses HTTPS with local certificates by default).

For detailed setup instructions including SSL certificates and troubleshooting, see the [local development guide](https://docs.shelf.nu/local-development).

## Project Structure

```
shelf.nu/
├── apps/
│   ├── webapp/          # Main application (React Router + Hono)
│   │   ├── app/
│   │   │   ├── routes/      # File-based routing
│   │   │   ├── modules/     # Business logic (booking, asset, kit, etc.)
│   │   │   ├── components/  # React components
│   │   │   └── utils/       # Shared utilities
│   │   └── public/          # Static assets
│   └── docs/            # Documentation site (VitePress)
├── packages/
│   └── database/        # Prisma schema, migrations, client
└── tooling/
    └── typescript/      # Shared TypeScript config
```

The monorepo is managed with pnpm workspaces and Turborepo. The `@shelf/database` package owns all database concerns — schema, migrations, and Prisma client generation.

## Commands

| Command                     | Description                             |
| --------------------------- | --------------------------------------- |
| `pnpm webapp:dev`           | Start development server                |
| `pnpm webapp:build`         | Production build                        |
| `pnpm webapp:test`          | Run tests (Vitest)                      |
| `pnpm webapp:validate`      | Lint + typecheck + test                 |
| `pnpm webapp:setup`         | Generate Prisma client + run migrations |https://github.com/Shelf-nu/shelf.nu/blob/main/README.md
| `pnpm db:prepare-migration` | Create a new database migration         |
| `pnpm db:deploy-migration`  | Apply pending migrations                |
| `pnpm db:reset`             | Reset database (destructive)            |
| `pnpm docs:dev`             | Start documentation site                |
| `pnpm typecheck`            | TypeScript type checking                |
| `pnpm lint`                 | ESLint                                  |

## Deployment

### Fly.io

Shelf deploys to [Fly.io](https://fly.io/) with GitHub Actions for CI/CD. Pushes to `dev` trigger staging deploys and pushes to `main` trigger production deploys; in both cases we run lint, typecheck, test, Docker build, and deploy.

See the [deployment guide](https://docs.shelf.nu/deployment) for full setup instructions.

### Docker

Community-maintained Docker support is available for self-hosting. Requires an external Supabase instance.

See the [Docker guide](https://docs.shelf.nu/docker).

## Documentation

| Guide                                                        | Description                                  |
| ------------------------------------------------------------ | -------------------------------------------- |
| [Local Development](https://docs.shelf.nu/local-development) | Full local setup with SSL, monorepo overview |
| [Supabase Setup](https://docs.shelf.nu/supabase-setup)       | Database, auth, storage configuration        |
| [Deployment](https://docs.shelf.nu/deployment)               | Fly.io + GitHub Actions CI/CD                |
| [Docker](https://docs.shelf.nu/docker)                       | Self-hosted Docker setup                     |
| [App Configuration](https://docs.shelf.nu/app-configuration) | `shelf.config.ts` options                    |
| [Error Handling](https://docs.shelf.nu/handling-errors)      | Error patterns and conventions               |
| [Accessibility](https://docs.shelf.nu/accessibility)         | WCAG 2.1 AA compliance                       |
| [Contributing](./CONTRIBUTING.md)                            | How to contribute                            |

For developer onboarding and codebase conventions, see [`CLAUDE.md`](./CLAUDE.md).

## Contributing

We welcome contributions. Check the [contribution guidelines](./CONTRIBUTING.md) and look for issues labeled [**"Open for contributions"**](https://github.com/Shelf-nu/shelf.nu/issues?q=is%3Aissue+is%3Aopen+label%3A%22Open+for+contributions%22).

The project uses [conventional commits](https://www.conventionalcommits.org/), enforced by commitlint. Pre-commit hooks run ESLint, Prettier, and TypeScript checking via Lefthook.

Join the [Discord](https://discord.gg/8he9W7aTJu) if you have questions or want to discuss your contribution.

## License

Shelf.nu is licensed under [AGPL-3.0](./LICENSE).
