# Local Development Guide 💻

This guide covers everything you need to know for developing Shelf.nu locally after completing the [Supabase Setup](./supabase-setup.md).

## Prerequisites ✅

- ✅ **Node.js** (>=22.20.0)
- ✅ **pnpm** (9.15.4+) — install via `corepack enable && corepack prepare pnpm@9.15.4 --activate`
- ✅ **Git**
- ✅ **Supabase project** configured ([Setup Guide](./supabase-setup.md))
- ✅ **`.env` file** with Supabase credentials (place in **monorepo root**, copy from `.env.example`)

---

## Monorepo Overview 📦

Shelf.nu is organized as a **pnpm + Turborepo monorepo**. All commands use `pnpm` instead of `npm`.

| Package                    | Path                  | Description                            |
| -------------------------- | --------------------- | -------------------------------------- |
| `@shelf/webapp`            | `apps/webapp/`        | Remix web application                  |
| `@shelf/docs`              | `apps/docs/`          | VitePress documentation site           |
| `@shelf/database`          | `packages/database/`  | Prisma client factory and shared types |
| `@shelf/typescript-config` | `tooling/typescript/` | Shared TypeScript configurations       |

Commands are scoped to specific packages using `pnpm --filter <package>` or run across the entire monorepo with `pnpm turbo <task>`.

**Convenience shortcuts** follow the `<app>:<task>` pattern and are available at the root:

```bash
# Webapp
pnpm webapp:dev        # Start webapp dev server
pnpm webapp:build      # Build webapp for production
pnpm webapp:test       # Run webapp unit tests
pnpm webapp:validate   # Run all webapp checks (lint, typecheck, format, tests)

# Docs
pnpm docs:dev          # Start docs dev server
pnpm docs:build        # Build docs for production
pnpm docs:preview      # Preview docs production build

# Database
pnpm webapp:setup               # Generate Prisma client and deploy migrations
pnpm db:generate         # Generate Prisma client after schema changes
pnpm db:prepare-migration # Create new database migration
pnpm db:deploy-migration  # Apply migrations and regenerate client
pnpm db:reset            # Reset database (destructive!)
```

---

## Development Setup 🚀

### 1. Clone & Install Dependencies

```bash
# Clone the repository
git clone https://github.com/Shelf-nu/shelf.nu.git
cd shelf.nu

# Install dependencies (uses pnpm workspaces)
pnpm install
```

### 2. Setup Local SSL (Optional but Recommended) 🔒

Shelf is configured to use HTTPS locally for a better development experience. You can set this up using `mkcert`:

#### Install mkcert

```bash
# macOS
brew install mkcert

# Ubuntu/Debian
sudo apt install libnss3-tools
wget -O mkcert https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64
chmod +x mkcert
sudo mv mkcert /usr/local/bin/

# Windows (using Chocolatey)
choco install mkcert
```

#### Generate SSL Certificates

```bash
# Install local CA
mkcert -install

# Create certificate directory inside the webapp folder
mkdir apps/webapp/.cert

# Generate certificates for localhost
mkcert -key-file apps/webapp/.cert/key.pem -cert-file apps/webapp/.cert/cert.pem localhost 127.0.0.1 ::1
```

#### Alternative: Disable SSL

If you prefer to run without SSL, edit `apps/webapp/vite.config.ts` and remove these lines:

```ts
// Remove or comment out these lines in apps/webapp/vite.config.ts
https: {
  key: "./.cert/key.pem",
  cert: "./.cert/cert.pem",
},
```

### 3. Initialize Database

This command sets up your database schema and runs initial migrations:

```bash
pnpm webapp:setup
```

### 4. Start Development Server

```bash
pnpm webapp:dev
```

**With SSL enabled:** Your app will be available at: `https://localhost:3000` 🔒  
**Without SSL:** Your app will be available at: `http://localhost:3000` 🎉

---

## Technology Stack 🛠️

Understanding Shelf's tech stack will help you develop effectively:

### Core Framework

- **[Remix](https://remix.run/)** - Full-stack web framework
- **[React](https://reactjs.org/)** - UI library
- **[TypeScript](https://typescriptlang.org/)** - Type safety

### Database & Backend

- **[Supabase](https://supabase.com/)** - Database and authentication
- **[Prisma](https://prisma.io/)** - Database ORM
- **[PostgreSQL](https://postgresql.org/)** - Database

### Styling & UI

- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS
- **Custom Components** - Built for asset management

### Development Tools

- **[Vite](https://vitejs.dev/)** - Build tool
- **[ESLint](https://eslint.org/)** - Code linting
- **[Prettier](https://prettier.io/)** - Code formatting

---

## Available Scripts 📜

### Development

```bash
pnpm webapp:dev      # Start development server
pnpm webapp:build    # Build webapp for production
pnpm turbo build     # Build all packages for production
pnpm webapp:start    # Start production server locally (loads root .env)
pnpm turbo typecheck # Run TypeScript checks (all packages)
```

### Database

```bash
pnpm webapp:setup               # Initial database setup
pnpm db:prepare-migration # Create new migration
pnpm db:deploy-migration  # Apply migrations and regenerate client
pnpm db:reset            # Reset database (careful!)
```

### Code Quality

```bash
pnpm turbo lint        # Run ESLint (all packages)
pnpm run format        # Format code with Prettier
pnpm webapp:validate   # Run all checks (lint, typecheck, format, tests)
```

### Testing

```bash
pnpm webapp:test -- --run                    # Run unit tests (always use --run flag)
pnpm --filter @shelf/webapp test:e2e         # Run end-to-end tests
pnpm --filter @shelf/webapp test:e2e:dev     # Run E2E tests in dev mode
pnpm --filter @shelf/webapp test:e2e:install # Install Playwright browsers
```

---

## Development Workflow 🔄

### Making Database Changes

1. **Update Prisma Schema**

   ```bash
   # Edit packages/database/prisma/schema.prisma
   ```

2. **Create Migration**

   ```bash
   pnpm db:prepare-migration
   ```

3. **Apply Migration**
   ```bash
   pnpm db:deploy-migration
   ```

### Adding New Features

1. **Create your feature files** in appropriate directories:

   - `apps/webapp/app/routes/` - New pages/routes
   - `apps/webapp/app/components/` - Reusable components
   - `apps/webapp/app/utils/` - Utility functions
   - `apps/webapp/app/modules/` - Business logic modules

2. **Follow the established patterns**:

   - Use TypeScript for type safety
   - Follow Remix conventions for data loading
   - Use Tailwind for styling
   - Add tests for new functionality

3. **Test your changes**:
   ```bash
   pnpm webapp:validate       # Check code quality
   pnpm webapp:test -- --run  # Run tests
   ```

---

## Project Structure 📁

```
shelf.nu/
├── .env.example                     # Environment variables template (copy to .env)
├── turbo.json                       # Turborepo pipeline config
├── pnpm-workspace.yaml              # Workspace package definitions
├── pnpm-lock.yaml                   # Lockfile (committed)
├── apps/
│   ├── webapp/                      # @shelf/webapp — Remix app
│   │   ├── app/
│   │   │   ├── components/          # Reusable UI components
│   │   │   ├── database/            # DB client (re-exports @shelf/database)
│   │   │   ├── modules/             # Business logic modules
│   │   │   ├── routes/              # Remix routes (pages)
│   │   │   ├── utils/               # Utility functions
│   │   │   └── root.tsx             # App root component
│   │   └── package.json
│   └── docs/                        # @shelf/docs — VitePress documentation
├── packages/
│   └── database/                    # @shelf/database — Prisma client + types
│       ├── prisma/
│       │   ├── schema.prisma        # Database schema
│       │   └── migrations/          # Database migrations
│       └── src/client.ts            # createDatabaseClient() factory
└── tooling/
    └── typescript/                  # Shared tsconfig bases
```

### Key Directories

**`apps/webapp/app/routes/`** - Each file becomes a route in your app:

- `_index.tsx` → `/`
- `assets._index.tsx` → `/assets`
- `assets.new.tsx` → `/assets/new`

**`apps/webapp/app/components/`** - Reusable React components:

- Follow atomic design principles
- Include TypeScript props interfaces
- Use Tailwind for styling

**`apps/webapp/app/modules/`** - Business logic organized by domain:

- `auth/` - Authentication logic
- `asset/` - Asset management
- `booking/` - Booking system

---

## Environment Configuration 🔧

Your `.env` file lives at the **monorepo root** (not inside `apps/webapp/`). Copy `.env.example` to `.env` and fill in your values.

### How env vars are loaded

Because the `.env` lives at the monorepo root but the webapp runs from `apps/webapp/`, different contexts load env vars differently:

| Context              | Command                                  | How env vars are loaded                                                                                                     |
| -------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Dev server**       | `pnpm webapp:dev`                        | Vite reads from `envDir: "../.."` (the monorepo root)                                                                       |
| **Local production** | `pnpm webapp:start`                      | Root script calls `start:local` which uses `dotenv -e ../../.env` to inject the root `.env` before starting the Node server |
| **Docker / Fly.io**  | `pnpm run start` (inside `apps/webapp/`) | Env vars are provided by the platform — no dotenv, no `.env` file needed                                                    |

> **Why the distinction?** The bare `start` script (`NODE_ENV=production node ./build/server/index.js`) does not load any `.env` file. In production (Docker/Fly), the platform injects env vars directly. For local production testing you need the `start:local` wrapper (called automatically by `pnpm webapp:start`) to load the root `.env`, otherwise required vars like `SESSION_SECRET` will be missing.

Here are the development-specific ones:

```bash
# Development server (adjust based on SSL setup)
SERVER_URL="https://localhost:3000"  # With SSL
# SERVER_URL="http://localhost:3000"  # Without SSL

# Database (from Supabase)
DATABASE_URL="your-supabase-connection-string"
DIRECT_URL="your-supabase-direct-connection"

# Disable premium features for local development
ENABLE_PREMIUM_FEATURES="false"

# Session security
SESSION_SECRET="your-local-session-secret"
```

---

## Database Development 🗄️

### Working with Prisma

**View your data:**

```bash
pnpm --filter @shelf/webapp exec prisma studio
```

This opens a web interface to browse your database.

**Reset database (destructive!):**

```bash
pnpm db:reset
```

### Creating Migrations

When you modify `packages/database/prisma/schema.prisma`:

1. **Prepare migration:**

   ```bash
   pnpm db:prepare-migration
   ```

2. **Review the generated SQL** in `packages/database/prisma/migrations/`

3. **Apply migration:**
   ```bash
   pnpm db:deploy-migration
   ```

---

## Testing 🧪

### Unit Testing with Vitest

```bash
pnpm webapp:test -- --run   # Run all unit tests
```

Create test files alongside your components:

```
components/
├── Button.tsx
└── Button.test.tsx
```

### End-to-End Testing with Playwright

```bash
pnpm --filter @shelf/webapp test:e2e:install  # Install browsers (first time)
pnpm --filter @shelf/webapp test:e2e:dev      # Run tests in development
```

E2E tests are in the `tests/e2e/` directory.

---

## Debugging 🐛

### Common Issues

**Port already in use:**

```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

**SSL Certificate errors:**

- Make sure you ran `mkcert -install` to install the local CA
- Regenerate certificates: `mkcert -key-file .cert/key.pem -cert-file .cert/cert.pem localhost`
- Or disable SSL by removing the `https` section from `apps/webapp/vite.config.ts`

**Database connection errors:**

- Check your root `.env` database URLs
- Verify Supabase project is running
- Ensure you have the correct password

**Build errors:**

```bash
# Clear node modules and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Development Tools

**Database inspection:**

```bash
pnpm --filter @shelf/webapp exec prisma studio  # Visual database browser
```

**Type checking:**

```bash
pnpm turbo typecheck  # Check for TypeScript errors
```

**Code formatting:**

```bash
pnpm run format     # Auto-format all code
```

---

## Hot Reloading 🔥

The development server includes hot reloading:

- **React components** - Changes update instantly
- **Routes** - New routes appear automatically
- **Styles** - CSS changes apply immediately
- **Server code** - Remix restarts the server

---

## VS Code Setup 💡

Recommended extensions:

- **Prisma** - Syntax highlighting for `.prisma` files
- **Tailwind CSS IntelliSense** - Auto-complete for CSS classes
- **TypeScript and JavaScript** - Enhanced TS support
- **Prettier** - Code formatting
- **ESLint** - Code linting

### Workspace Settings

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

---

## Performance Tips 🚀

### Development Performance

- **Use TypeScript strict mode** for better error catching
- **Run tests frequently** to catch issues early
- **Use Prisma Studio** for database inspection instead of raw SQL
- **Leverage Remix's built-in optimizations** (no need for extra bundlers)

### Database Performance

- **Use database indexes** for frequently queried fields
- **Limit data in development** - Use `.take()` to limit results
- **Use Prisma's `include` and `select`** to fetch only needed data

---

## Next Steps 🎯

Once you're comfortable with local development:

1. **Explore the codebase** - Look at existing routes and components
2. **Read the other docs** - Check out [hooks](./hooks.md), [error handling](./handling-errors.md), etc.
3. **Join the community** - [Discord](https://discord.gg/8he9W7aTJu) for questions
4. **Contribute** - See [CONTRIBUTING.md](./contributing.md)
5. **Deploy** - Check out [Deployment Guide](./deployment.md) when ready

---

## Getting Help 💬

- 💬 **[Discord Community](https://discord.gg/8he9W7aTJu)** - Chat with other developers
- 📖 **[Documentation](./README.md)** - Browse all guides
- 🐛 **[GitHub Issues](https://github.com/Shelf-nu/shelf.nu/issues)** - Report bugs or request features
- 🐦 **[Twitter](https://twitter.com/ShelfQR)** - Follow for updates

Happy coding! 🎉
