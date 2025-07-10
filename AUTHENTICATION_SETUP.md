# Authentication Setup Guide

## Google OAuth Configuration

To enable Google SSO authentication, you need to set up Google OAuth credentials:

### 1. Create Google OAuth App

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to "APIs & Services" > "Credentials"
4. Click "Create Credentials" > "OAuth 2.0 Client IDs"
5. Choose "Web application" as the application type
6. Add your authorized redirect URIs:
   - For development: `http://localhost:3000/api/auth/callback/google`
   - For production: `https://yourdomain.com/api/auth/callback/google`
7. Copy the Client ID and Client Secret

### 2. Environment Variables

Create a `.env.local` file in your project root with the following variables:

```bash
# Database
DATABASE_URL="file:./dev.db"

# NextAuth.js
NEXTAUTH_URL="http://localhost:3000"  # Change to your domain in production
NEXTAUTH_SECRET="your-secret-key-here-change-this-in-production"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id-from-step-1"
GOOGLE_CLIENT_SECRET="your-google-client-secret-from-step-1"

# OpenAI (existing)
OPENAI_API_KEY="your-openai-api-key"
```

### 3. Generate NextAuth Secret

You can generate a secure secret using:

```bash
openssl rand -base64 32
```

Or use this online generator: https://generate-secret.vercel.app/32

### 4. Start the Application

```bash
npm run dev
```

## Features Added

- ✅ Google OAuth authentication
- ✅ Protected chat interface (requires login)
- ✅ User profile display in navigation
- ✅ Secure session management
- ✅ Database storage for user data
- ✅ Personalized chat responses
- ✅ Beautiful sign-in UI

## Usage

1. Visit your application
2. Click "Sign in" to authenticate with Google
3. Once authenticated, you'll have access to the chat interface
4. Your user profile will appear in the top navigation
5. Chat responses will be personalized with your name

## Security Features

- Authentication required for API access
- Secure session management with JWT
- User data stored in local SQLite database
- CSRF protection via NextAuth.js
- Secure OAuth flow with Google 