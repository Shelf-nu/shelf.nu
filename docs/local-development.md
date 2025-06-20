# Local Development Guide 💻

This guide covers everything you need to know for developing Shelf.nu locally after completing the [Supabase Setup](./supabase-setup.md).

## Prerequisites ✅

- ✅ **Node.js** (v20 or higher)
- ✅ **npm** or **yarn**
- ✅ **Git**
- ✅ **Supabase project** configured ([Setup Guide](./supabase-setup.md))
- ✅ **`.env` file** with Supabase credentials

---

## Development Setup 🚀

### 1. Clone & Install Dependencies

```bash
# Clone the repository
git clone https://github.com/Shelf-nu/shelf.nu.git
cd shelf.nu

# Install dependencies
npm install
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

# Create certificate directory
mkdir .cert

# Generate certificates for localhost
mkcert -key-file .cert/key.pem -cert-file .cert/cert.pem localhost 127.0.0.1 ::1
```

#### Alternative: Disable SSL

If you prefer to run without SSL, edit `vite.config.ts` and remove these lines:

```ts
// Remove or comment out these lines in vite.config.ts
https: {
  key: "./.cert/key.pem",
  cert: "./.cert/cert.pem",
},
```

### 3. Initialize Database

This command sets up your database schema and runs initial migrations:

```bash
npm run setup
```

### 4. Start Development Server

```bash
npm run dev
```

**With SSL enabled:** Your app will be available at: **https://localhost:3000** 🔒  
**Without SSL:** Your app will be available at: **http://localhost:3000** 🎉

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
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run typecheck    # Run TypeScript checks
```

### Database

```bash
npm run setup                    # Initial database setup
npm run db:prepare-migration     # Create new migration
npm run db:deploy-migration      # Apply migrations
npm run db:migrate               # Run migrations in dev
npm run db:reset                 # Reset database (careful!)
npm run db:seed                  # Seed database with sample data
```

### Code Quality

```bash
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run validate     # Run all checks (lint, typecheck, format)
```

### Testing

```bash
npm run test                # Run unit tests
npm run test:e2e           # Run end-to-end tests
npm run test:e2e:dev       # Run E2E tests in dev mode
npm run test:e2e:install   # Install Playwright browsers
```

---

## Development Workflow 🔄

### Making Database Changes

1. **Update Prisma Schema**

   ```bash
   # Edit app/database/schema.prisma
   ```

2. **Create Migration**

   ```bash
   npm run db:prepare-migration
   ```

3. **Apply Migration**
   ```bash
   npm run db:deploy-migration
   ```

### Adding New Features

1. **Create your feature files** in appropriate directories:

   - `app/routes/` - New pages/routes
   - `app/components/` - Reusable components
   - `app/utils/` - Utility functions
   - `app/modules/` - Business logic modules

2. **Follow the established patterns**:

   - Use TypeScript for type safety
   - Follow Remix conventions for data loading
   - Use Tailwind for styling
   - Add tests for new functionality

3. **Test your changes**:
   ```bash
   npm run validate  # Check code quality
   npm run test      # Run tests
   ```

---

## Project Structure 📁

```
shelf.nu/
├── app/
│   ├── components/          # Reusable UI components
│   ├── database/           # Prisma schema and migrations
│   ├── modules/            # Business logic modules
│   ├── routes/             # Remix routes (pages)
│   ├── styles/             # CSS and styling
│   ├── utils/              # Utility functions
│   └── root.tsx           # App root component
├── docs/                   # Documentation
├── public/                 # Static assets
├── tests/                  # Test files
├── .env.example           # Environment variables template
└── package.json           # Dependencies and scripts
```

### Key Directories

**`app/routes/`** - Each file becomes a route in your app:

- `_index.tsx` → `/`
- `assets._index.tsx` → `/assets`
- `assets.new.tsx` → `/assets/new`

**`app/components/`** - Reusable React components:

- Follow atomic design principles
- Include TypeScript props interfaces
- Use Tailwind for styling

**`app/modules/`** - Business logic organized by domain:

- `auth/` - Authentication logic
- `asset/` - Asset management
- `booking/` - Booking system

---

## Environment Configuration 🔧

Your `.env` file should include all necessary variables. Here are the development-specific ones:

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
npx prisma studio
```

This opens a web interface to browse your database.

**Reset database (destructive!):**

```bash
npm run db:reset
```

**Seed with sample data:**

```bash
npm run db:seed
```

### Creating Migrations

When you modify `schema.prisma`:

1. **Prepare migration:**

   ```bash
   npm run db:prepare-migration
   ```

2. **Review the generated SQL** in `app/database/migrations/`

3. **Apply migration:**
   ```bash
   npm run db:deploy-migration
   ```

---

## Testing 🧪

### Unit Testing with Vitest

```bash
npm run test        # Run all unit tests
npm run test:watch  # Run tests in watch mode
```

Create test files alongside your components:

```
components/
├── Button.tsx
└── Button.test.tsx
```

### End-to-End Testing with Playwright

```bash
npm run test:e2e:install  # Install browsers (first time)
npm run test:e2e:dev      # Run tests in development
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
- Or disable SSL by removing the `https` section from `vite.config.ts`

**Database connection errors:**

- Check your `.env` database URLs
- Verify Supabase project is running
- Ensure you have the correct password

**Build errors:**

```bash
# Clear node modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Development Tools

**Database inspection:**

```bash
npx prisma studio  # Visual database browser
```

**Type checking:**

```bash
npm run typecheck  # Check for TypeScript errors
```

**Code formatting:**

```bash
npm run format     # Auto-format all code
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
3. **Join the community** - [Discord](https://discord.gg/gdPMsSzqCS) for questions
4. **Contribute** - See [CONTRIBUTING.md](../CONTRIBUTING.md)
5. **Deploy** - Check out [Deployment Guide](./deployment.md) when ready

---

## Getting Help 💬

- 💬 **[Discord Community](https://discord.gg/gdPMsSzqCS)** - Chat with other developers
- 📖 **[Documentation](./README.md)** - Browse all guides
- 🐛 **[GitHub Issues](https://github.com/Shelf-nu/shelf.nu/issues)** - Report bugs or request features
- 🐦 **[Twitter](https://twitter.com/ShelfQR)** - Follow for updates

Happy coding! 🎉
