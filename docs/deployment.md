# Deployment Guide 🚀

This guide covers deploying Shelf.nu to production environments. We'll focus on Fly.io deployment with GitHub Actions for CI/CD.

## Prerequisites ✅

- ✅ **Working local development setup** ([Local Development Guide](./local-development.md))
- ✅ **Supabase project configured** ([Supabase Setup Guide](./supabase-setup.md))
- ✅ **GitHub repository** with your Shelf.nu code
- ✅ **Fly.io account** (free tier available)

---

## Overview 📋

This deployment setup includes:

- 🚀 **Fly.io hosting** - Fast, global app deployment
- 🔄 **GitHub Actions** - Automated CI/CD pipeline
- 🌍 **Multi-environment** - Separate staging and production
- 📧 **Email service** - For authentication and notifications
- 🔒 **Security** - Environment secrets and best practices

---

## Step 1: Install Fly CLI 🛠️

### macOS/Linux

```bash
curl -L https://fly.io/install.sh | sh
```

### Windows

```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

### Verify Installation

```bash
fly version
```

---

## Step 2: Authenticate with Fly.io 🔐

```bash
fly auth signup  # If you don't have an account
# OR
fly auth login   # If you already have an account
```

> 💡 **Multiple accounts?** Run `fly auth whoami` to verify you're logged into the correct account.

---

## Step 3: Create Fly.io Apps 📱

Create separate apps for staging and production:

```bash
# Production app (should match your fly.toml)
fly apps create shelf-webapp

# Staging app (optional but recommended)
fly apps create shelf-webapp-staging
```

> 🔧 **Important**: The production app name must match the `app` field in your `fly.toml` file.

---

## Step 4: Setup Production Supabase 🗄️

### Option A: Separate Production Database

Create a new Supabase project for production following the [Supabase Setup Guide](./supabase-setup.md).

### Option B: Use Development Database

You can use your existing Supabase project for production (not recommended for sensitive data).

### Update Supabase URLs for Production

In your production Supabase project:

1. **Go to Authentication** → **URL Configuration**
2. **Add your production URLs**:
   ```
   https://your-production-app.fly.dev/reset-password
   https://your-staging-app.fly.dev/reset-password
   ```

---

## Step 5: Configure Environment Secrets 🔒

Set environment variables for your Fly.io apps:

### Production Secrets

```bash
# Basic app configuration
fly secrets set SESSION_SECRET=$(openssl rand -hex 32)
fly secrets set SERVER_URL="https://your-production-app.fly.dev"
fly secrets set FINGERPRINT=$(openssl rand -hex 32)

# Supabase configuration
fly secrets set SUPABASE_URL="https://your-production-project.supabase.co"
fly secrets set SUPABASE_SERVICE_ROLE="your-production-service-role-key"
fly secrets set SUPABASE_ANON_PUBLIC="your-production-anon-key"
fly secrets set DATABASE_URL="postgres://user:pass@host:6543/db?pgbouncer=true&connection_limit=1"
fly secrets set DIRECT_URL="postgres://user:pass@host:5432/db"

# Email configuration (required)
fly secrets set SMTP_HOST="smtp.yourhost.com"
fly secrets set SMTP_PORT=465
fly secrets set SMTP_USER="you@example.com"
fly secrets set SMTP_PWD="yourSMTPpassword"
fly secrets set SMTP_FROM="Shelf.nu <noreply@yourapp.com>"

# Security tokens
fly secrets set INVITE_TOKEN_SECRET=$(openssl rand -hex 32)

# Optional integrations
fly secrets set MAPTILER_TOKEN="your-maptiler-token"
fly secrets set GEOCODE_API_KEY="your-geocode-api-key"
fly secrets set MICROSOFT_CLARITY_ID="your-clarity-id"

# Premium features (set to true for paid features)
fly secrets set ENABLE_PREMIUM_FEATURES="true"

# Stripe (if using premium features)
fly secrets set STRIPE_SECRET_KEY="your-stripe-secret-key"
fly secrets set STRIPE_PUBLIC_KEY="your-stripe-public-key"
fly secrets set STRIPE_WEBHOOK_ENDPOINT_SECRET="your-stripe-webhook-secret"
```

### Staging Secrets (Optional)

```bash
# Repeat similar commands with --app shelf-webapp-staging
fly secrets set SESSION_SECRET=$(openssl rand -hex 32) --app shelf-webapp-staging
fly secrets set SERVER_URL="https://your-staging-app.fly.dev" --app shelf-webapp-staging
# ... etc for all other secrets
```

> 🔐 **Security Note**: Use different passwords and secrets for staging vs production!

---

## Step 6: Setup GitHub Actions 🔄

### Add Repository Secrets

In your GitHub repository, go to **Settings** → **Secrets and variables** → **Actions** and add:

```bash
FLY_API_TOKEN=your-fly-api-token
```

**To get your Fly API token:**

1. Go to [Fly.io Personal Access Tokens](https://web.fly.io/user/personal_access_tokens/new)
2. Create a new token
3. Copy and add to GitHub secrets

### GitHub Action Configuration

The repository should already include GitHub Actions workflows:

- **`.github/workflows/deploy.yml`** - Deploys `main` branch to production
- **`.github/workflows/deploy-staging.yml`** - Deploys `dev` branch to staging

### Environment Secrets for GitHub Actions

Add these secrets for testing in GitHub Actions:

```bash
DATABASE_URL=your-test-database-url
DIRECT_URL=your-test-direct-url
SUPABASE_URL=your-test-supabase-url
SUPABASE_SERVICE_ROLE=your-test-service-role
SUPABASE_ANON_PUBLIC=your-test-anon-key
SESSION_SECRET=test-session-secret
SERVER_URL=http://localhost:3000  # Important for tests!
```

---

## Step 7: Deploy Your Application 🎉

### Manual Deployment (First Time)

Deploy manually to test everything works:

```bash
# Deploy to production
fly deploy

# Deploy to staging (specify app)
fly deploy --app shelf-webapp-staging
```

### Automatic Deployment

Once GitHub Actions are configured:

- **Push to `main` branch** → Deploys to production
- **Push to `dev` branch** → Deploys to staging

---

## Step 8: Setup Custom Domain (Optional) 🌐

### Add Domain to Fly.io

```bash
fly certs create yourdomain.com
fly certs create www.yourdomain.com
```

### Configure DNS

Point your domain to Fly.io:

```
A record: @ → [Fly.io IP address from dashboard]
CNAME: www → yourapp.fly.dev
```

### Update Environment Variables

```bash
fly secrets set SERVER_URL="https://yourdomain.com"
```

---

## Step 9: Monitoring & Maintenance 📊

### View Logs

```bash
fly logs           # Recent logs
fly logs -f        # Follow logs in real-time
```

### Monitor App Health

```bash
fly status         # App status
fly checks list    # Health checks
```

### Scale Your App

```bash
fly scale count 2              # Run 2 instances
fly scale vm shared-cpu-1x     # Change VM size
```

---

## Email Service Setup 📧

Shelf requires email for authentication. Here are recommended providers:

### Resend (Recommended)

1. **Sign up** at [Resend](https://resend.com/)
2. **Create API key** in your dashboard
3. **Configure SMTP**:
   ```bash
   fly secrets set SMTP_HOST="smtp.resend.com"
   fly secrets set SMTP_PORT=587
   fly secrets set SMTP_USER="resend"
   fly secrets set SMTP_PWD="your-resend-api-key"
   fly secrets set SMTP_FROM="Shelf.nu <noreply@yourdomain.com>"
   ```

### SendGrid

1. **Sign up** at [SendGrid](https://sendgrid.com/)
2. **Create API key** with "Mail Send" permissions
3. **Configure SMTP**:
   ```bash
   fly secrets set SMTP_HOST="smtp.sendgrid.net"
   fly secrets set SMTP_PORT=587
   fly secrets set SMTP_USER="apikey"
   fly secrets set SMTP_PWD="your-sendgrid-api-key"
   ```

### Mailgun

1. **Sign up** at [Mailgun](https://mailgun.com/)
2. **Get SMTP credentials** from your domain dashboard
3. **Configure secrets** with your Mailgun SMTP details

### Gmail (Development Only)

⚠️ **Not recommended for production**

1. **Enable 2-factor authentication**
2. **Create app password**
3. **Use app password as SMTP_PWD**

---

## Security Best Practices 🔒

### Environment Secrets

- ✅ **Never commit secrets** to your repository
- ✅ **Use different secrets** for staging vs production
- ✅ **Rotate secrets regularly**
- ✅ **Use strong passwords** (minimum 32 characters)

### Database Security

- ✅ **Use connection pooling** (`pgbouncer=true`)
- ✅ **Limit connection count** (`connection_limit=1`)
- ✅ **Keep Supabase updated**
- ✅ **Monitor unusual activity**

### Application Security

- ✅ **Enable HTTPS only** (Fly.io provides this)
- ✅ **Set secure headers** (included in Shelf)
- ✅ **Monitor error logs**
- ✅ **Keep dependencies updated**

---

## Troubleshooting 🔧

### Common Deployment Issues

**Build Failures:**

```bash
# Check build logs
fly logs --app your-app-name

# Deploy with more verbose output
fly deploy --verbose
```

**Database Connection Issues:**

- Verify your `DATABASE_URL` includes `pgbouncer=true`
- Check your Supabase project is running
- Ensure connection limits are appropriate

**Authentication Problems:**

- Verify Supabase URL configuration includes your production URLs
- Check email templates use `{{ .Token }}` format
- Test SMTP configuration with a simple email

**Performance Issues:**

```bash
# Scale up your app
fly scale vm performance-1x

# Add more instances
fly scale count 2
```

### Useful Commands

```bash
# App information
fly info

# Scale configuration
fly scale show

# Certificate status
fly certs list

# SSH into your app
fly ssh console

# Database operations
fly postgres connect -a your-db-app
```

---

## Monitoring & Analytics 📈

### Built-in Monitoring

- **Fly.io Dashboard** - Basic metrics and logs
- **Supabase Dashboard** - Database performance and usage

### Optional Integrations

**Microsoft Clarity (Free):**

```bash
fly secrets set MICROSOFT_CLARITY_ID="your-clarity-id"
```

**Sentry (Error Tracking):**
Add Sentry configuration to track application errors.

---

## Cost Optimization 💰

### Fly.io Pricing Tips

- **Start with shared CPU** instances (cheaper)
- **Use auto-scaling** to handle traffic spikes
- **Monitor usage** in the Fly.io dashboard
- **Consider regional deployment** for better performance

### Supabase Pricing

- **Free tier** includes substantial usage
- **Monitor database size** and queries
- **Use database indexes** for better performance
- **Archive old data** to stay within limits

---

## Backup Strategy 💾

### Database Backups

- **Supabase** automatically backs up your database
- **Download backups** from Supabase dashboard
- **Test restore procedures** regularly

### Application Backups

- **Code** is backed up in GitHub
- **Environment secrets** should be documented securely
- **File uploads** are stored in Supabase storage

---

## Next Steps 🎯

After successful deployment:

1. 🧪 **Test thoroughly** - Verify all features work in production
2. 👥 **Invite team members** - Share access to Fly.io and Supabase
3. 📊 **Monitor usage** - Set up alerts for errors and performance
4. 🔄 **Plan updates** - Use staging environment for testing changes
5. 📖 **Document your setup** - Keep deployment details for your team

---

## Getting Help 💬

- 💬 **[Discord Community](https://discord.gg/8he9W7aTJu)** - Get help from other users
- 📖 **[Fly.io Docs](https://fly.io/docs/)** - Official Fly.io documentation
- 🐛 **[GitHub Issues](https://github.com/Shelf-nu/shelf.nu/issues)** - Report deployment issues
- 📧 **[Fly.io Support](https://fly.io/docs/getting-help/)** - Fly.io specific support

Congratulations on deploying Shelf.nu! 🎉
