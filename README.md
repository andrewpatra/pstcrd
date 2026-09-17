# Video Message Consent Test

Low-fidelity, text-only prototype for the eventual mobile video-message project.

## Architecture

- **GitHub**: source control and GitHub Pages hosting for the static site.
- **Supabase**: PostgreSQL database and Edge Functions.
- **Resend**: transactional email delivery.

```text
Mobile browser
    |
    v
GitHub Pages (site/)
    |
    v
Supabase Edge Functions
    |
    +--> PostgreSQL (recipients, messages, consent tokens)
    |
    +--> Resend (email)
```

## Current flow

1. Sender opens the site and enters a name, recipient email, and text.
2. The `send-message` Edge Function checks the recipient's consent state.
3. A new/pending recipient gets a consent request first; the message is held in the database.
4. The recipient can accept or decline that message, or revoke future requests.
5. Accepting records consent and sends the text message.
6. Once approved, later messages are delivered without another consent request.

## Repository layout

```text
site/                       Static GitHub Pages site
supabase/schema.sql         Database schema
supabase/config.toml        Edge Function configuration
supabase/functions/         Edge Functions
.github/workflows/pages.yml GitHub Pages deployment
SETUP.md                    Setup instructions
```

## Security notes for this class prototype

- Never commit `RESEND_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
- The browser uses only the Supabase publishable key.
- The database tables have Row Level Security enabled and are not directly writable by the anonymous browser.
- The Edge Functions are intentionally public (`verify_jwt = false`) so a static GitHub Pages site can invoke them. Before a public deployment, add rate limiting and abuse protection (for example, CAPTCHA) and tighten validation.
- Videos are intentionally not implemented yet.
