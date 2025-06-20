# Supabase Setup Guide 🗄️

This guide will walk you through setting up Supabase for your Shelf.nu application. Supabase provides our database, authentication, and file storage.

## Prerequisites ✅

- A [Supabase account](https://supabase.com/) (free tier available)
- Access to your `.env` file in your local Shelf.nu project

---

## Step 1: Create Your Supabase Project 🆕

1. **Sign up/Login** to [Supabase](https://supabase.com/)
2. **Click "New Project"**
3. **Choose your organization** (or create one)
4. **Fill in project details:**

   - **Name**: `shelf-nu` (or your preferred name)
   - **Database Password**: Create a strong password (save this! 🔐)
   - **Region**: Choose closest to your location
   - **Pricing Plan**: Free tier works great for development

5. **Click "Create new project"**
6. ⏳ Wait for your project to be ready (usually 1-2 minutes)

---

## Step 2: Get Your Connection Details 🔗

### Database Connection Strings

1. **Click the "Connect" button** in your project header
2. **Select "ORM"** → **"Prisma"**
3. **Copy the connection strings** and update your `.env` (replace `[YOUR-PASSWORD]` with your actual database password):

```bash
# Connection pooling (for app runtime)
DATABASE_URL="postgres://postgres.xxxxx:[YOUR-PASSWORD]@xxx.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Direct connection (for migrations)
DIRECT_URL="postgres://postgres.xxxxx:[YOUR-PASSWORD]@xxx.supabase.com:5432/postgres"
```

> 💡 **Important**: Replace `[YOUR-PASSWORD]` with your actual database password

### API Keys

1. **Go to Project Settings** → **API keys**
2. **Copy the API keys** and update your `.env`:

```bash
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_ANON_PUBLIC="your-anon-public-key"
SUPABASE_SERVICE_ROLE="your-service-role-key"
```

---

## Step 3: Configure Database Connection Mode 🔧

1. **Go to Project Settings** → **Database**
2. **Find "Connection pooling"** section
3. **Set Mode to "Transaction"**
4. **Click "Save"**

---

## Step 4: Setup Authentication 🔐

### Configure Auth Settings

1. **Go to Authentication** → **URL Configuration**
2. **Site URL**: Set to `https://localhost:3000` (for development with SSL) or `http://localhost:3000` (without SSL)
3. **Redirect URLs**: Add these URLs:
   ```
   https://localhost:3000/reset-password
   http://localhost:3000/reset-password
   https://your-staging-domain.com/reset-password
   https://your-live-domain.com/reset-password
   ```

> 💡 **Note**: Include both HTTP and HTTPS localhost URLs to support different SSL configurations

### Setup Email Templates for OTP

Shelf uses One-Time Passwords (OTP) instead of magic links. Update the email templates:

1. **Go to Authentication** → **Email Templates**
2. **Update each template** with the content below:

<details>
<summary><strong>📧 Confirm Signup Template</strong> (click to expand)</summary>

Replace the entire email content with:

```html
<p>
  To confirm your account, please use the following One Time Password (OTP):
</p>
<h2><b>&#123;&#123; .Token &#125;&#125;</b></h2>
<p>
  Don't share this OTP with anyone. Our customer service team will never ask you
  for your password, OTP, credit card, or banking info. We hope to see you again
  soon.
</p>
```

</details>

<details>
<summary><strong>🔐 Magic Link Template</strong> (click to expand)</summary>

Replace the entire email content with:

```html
<p>To authenticate, please use the following One Time Password (OTP):</p>
<h2><b>&#123;&#123; .Token &#125;&#125;</b></h2>
<p>
  Don't share this OTP with anyone. Our customer service team will never ask you
  for your password, OTP, credit card, or banking info. We hope to see you again
  soon.
</p>
```

</details>

<details>
<summary><strong>🔄 Reset Password Template</strong> (click to expand)</summary>

Replace the entire email content with:

```html
<h2>Reset Password</h2>
<p>To reset your password, please use the following (OTP):</p>
<h2><b>&#123;&#123; .Token &#125;&#125;</b></h2>
<p>
  Don't share this OTP with anyone. Our customer service team will never ask you
  for your password, OTP, credit card, or banking info. We hope to see you again
  soon.
</p>
```

</details>

3. **Click "Save"** for each template after updating

---

## Step 5: Create Storage Buckets 🪣

Shelf needs several storage buckets for file uploads. For each bucket below:

### Profile Pictures

1. **Go to Storage** → **Buckets**
2. **Click "Create bucket"**
3. **Name**: `profile-pictures`
4. **Make it public**: ✅ Checked
5. **Click "Create"**

**Setup Policies:**

1. **Click on the bucket** → **Policies**
2. **Create policy for INSERT, UPDATE, DELETE** with:
   - **Expression**: `(bucket_id = 'profile-pictures'::text) AND (false)`
   - **Target roles**: `authenticated` and `anon`

### Assets

1. **Create bucket**: `assets`
2. **Public**: ❌ Unchecked
3. **Policies**: Same as above but with `(bucket_id = 'assets'::text) AND (false)`

### Kits

1. **Create bucket**: `kits`
2. **Public**: ❌ Unchecked
3. **Policies**: Same as above but with `(bucket_id = 'kits'::text) AND (false)`

### Files

1. **Create bucket**: `files`
2. **Public**: ✅ Checked
3. **Policies**: Same as above but with `(bucket_id = 'files'::text) AND (false)`

> 💡 **Why these policies?** They prevent direct browser access to modify files while allowing our server to manage them securely.

---

## Step 6: Complete Your .env File 📝

Your `.env` should now look like this:

```bash
# Database connections
DATABASE_URL="postgres://postgres.xxxxx:[YOUR-PASSWORD]@xxx.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgres://postgres.xxxxx:[YOUR-PASSWORD]@xxx.supabase.com:5432/postgres"

# Supabase API
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_ANON_PUBLIC="your-anon-public-key"
SUPABASE_SERVICE_ROLE="your-service-role-key"

# App configuration
SESSION_SECRET="your-super-secret-session-key"
SERVER_URL="https://localhost:3000"  # With SSL (recommended)
# SERVER_URL="http://localhost:3000"  # Without SSL
FINGERPRINT="a-custom-host-fingerprint"

# Features (optional - set to false to disable premium features)
ENABLE_PREMIUM_FEATURES="false"

# Email configuration (required for auth emails)
SMTP_HOST="smtp.yourhost.com"
SMTP_PORT=465
SMTP_USER="you@example.com"
SMTP_PWD="yourSMTPpassword"
SMTP_FROM="You from Shelf.nu <you@example.com>"

# Map integration (optional)
MAPTILER_TOKEN="your-maptiler-token"

# Geocoding (optional)
GEOCODE_API_KEY="your-geocode-api-key"

# Security
INVITE_TOKEN_SECRET="your-invite-token-secret"

# Analytics (optional)
MICROSOFT_CLARITY_ID="your-clarity-id"
```

---

## Step 7: Generate Session Secrets 🔐

Generate secure random strings for your secrets:

```bash
# Generate session secret
openssl rand -hex 32

# Generate invite token secret
openssl rand -hex 32

# Generate fingerprint
openssl rand -hex 32
```

Copy these values to your `.env` file.

---

## Step 8: Setup Email (Required) 📧

Shelf requires email configuration for user authentication. You can use:

- **Gmail**: Use app passwords
- **SendGrid**: Free tier available
- **Mailgun**: Free tier available
- **Any SMTP provider**

Update the SMTP settings in your `.env` file with your email provider's details.

---

## Step 9: Optional Integrations 🔌

### Map Integration

Get a free [MapTiler](https://www.maptiler.com/) account for location features:

1. Sign up at MapTiler
2. Get your API key
3. Add to your `.env` file:

```bash
MAPTILER_TOKEN="your_token_here"
```

### Geocoding

Get a free [Geocode Maps](https://geocode.maps.co/) API key:

1. Sign up for geocoding service
2. Add to your `.env` file:

```bash
GEOCODE_API_KEY="your_key_here"
```

---

## Verification ✅

Your Supabase setup is complete! You should now have:

- ✅ Supabase project created
- ✅ Database connection strings in `.env`
- ✅ API keys in `.env`
- ✅ Connection mode set to "Transaction"
- ✅ Auth templates configured for OTP
- ✅ Storage buckets created with policies
- ✅ Email configuration completed
- ✅ Session secrets generated

## Next Steps 🚀

Now you can return to the main setup and run:

```bash
npm run setup
npm run dev
```

**With SSL:** Your Shelf.nu app will be available at `https://localhost:3000` 🔒  
**Without SSL:** Your Shelf.nu app will be available at `http://localhost:3000` 🎉

Your app should connect to Supabase successfully!

---

## Troubleshooting 🔧

### Common Issues

**Connection Error**: Double-check your database password and connection strings  
**Auth Not Working**: Verify email templates use the escaped token syntax instead of URLs  
**File Upload Fails**: Ensure storage buckets exist and have proper policies  
**Email Issues**: Test your SMTP settings with a simple email client first

### Getting Help

- 💬 [Join our Discord](https://discord.gg/8he9W7aTJu)
- 📖 [Browse all documentation](./README.md)
- 🐛 [Report issues on GitHub](https://github.com/Shelf-nu/shelf.nu/issues)

---

## Production Setup 🚀

This guide covers development setup. For production deployment, see our [Deployment Guide](./deployment.md).
