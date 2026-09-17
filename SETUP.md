# Setup: GitHub + Supabase + Resend

This is the first text-only end-to-end test.

## 1. Create the GitHub repository

Create a new GitHub repository and copy this project into it. The repository should use `main` as its default branch.

## 2. Configure GitHub Pages

The included workflow at `.github/workflows/pages.yml` deploys the `site/` directory whenever `main` changes.

In the GitHub repository settings, enable Pages using **GitHub Actions** if GitHub asks for a Pages source.

`site/config.js` is intentionally part of the static site. It contains only the browser-safe Supabase project URL and publishable key. Replace the placeholder values there before testing. Do not put a service-role key in this file.

## 3. Create Supabase project

Create a Supabase project.

In the SQL Editor, paste and run:

supabase/schema.sql

The tables have Row Level Security enabled with no anonymous table policies. The browser calls Edge Functions instead of writing to the tables directly.

## 4. Configure Supabase Edge Functions

The repository contains:

supabase/functions/send-message/index.ts supabase/functions/consent/index.ts

The easiest first test is to deploy them with the Supabase CLI. From the repository root:

supabase login supabase link --project-ref dvflrnxilkiuiyfjzocq supabase functions deploy send-message --no-verify-jwt supabase functions deploy consent --no-verify-jwt

The included `supabase/config.toml` also documents the intended `verify_jwt = false` setting for these two functions.

## 5. Create Resend API key

Create a Resend account and API key. Configure an allowed sender address/domain according to Resend's current account requirements.

## 6. Set Supabase secrets

In Supabase, set these Edge Function secrets:

RESEND_API_KEY=re_... SUPABASE_SERVICE_ROLE_KEY=... APP_BASE_URL=https://pstcrd.art RESEND_FROM_EMAIL=Video Message Test <your-sender@example.com>

Do not put either secret key in the GitHub repository or in the HTML.

`APP_BASE_URL` should be the public base URL where `index.html` and `consent.html` are served.

## 7. Configure the site

Edit:

site/config.js

Set:

SUPABASE_URL SUPABASE_PUBLISHABLE_KEY

Only use the Supabase publishable/anon key in browser code. Never use the service-role key.

Commit and push the change. GitHub Pages will redeploy automatically.

## 8. Test the workflow

1. Open the GitHub Pages URL on a phone or desktop.

2. Enter your own email address as the recipient.

3. Submit a text message.

4. Confirm that the consent request arrives.

5. Click **Accept this message**.

6. Confirm that the second email containing the text arrives.

7. Submit another message to the same address; it should be delivered without a second consent request.

8. Test **Decline** and **Stop future requests** with another test address.

## Next phase

Once this works, add Supabase Storage and a `video_path` column to `messages`. The consent workflow can remain largely unchanged.