# Freshbooks Integration — Setup Guide

## Overview

The integration uses a Firebase Cloud Function as a secure middleman so your
Freshbooks Client Secret **never appears in the public HTML file**.

```
Browser ──OAuth──▶ Freshbooks ──code──▶ Firebase Function ──tokens──▶ Firebase DB
         ◀──redirect─────────────────────────────────────────────────
```

---

## Step 1 — Upgrade Firebase to Blaze plan (required for Functions)

The free Spark plan does not allow Cloud Functions.

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Open **coradam-planner**
3. Click **Upgrade** (bottom-left) → select **Blaze (pay as you go)**
4. Add a billing account (Google will not charge you unless you exceed the very
   generous free tier: 2 million function calls / month)

---

## Step 2 — Add the Freshbooks callback URL to your Freshbooks app

1. Go to [developers.freshbooks.com](https://developers.freshbooks.com)
2. Open your app → **App Settings**
3. Under **Redirect URIs**, add exactly:

```
https://us-central1-coradam-planner.cloudfunctions.net/freshbooksCallback
```

4. Save.

---

## Step 3 — Install Firebase CLI (one-time, on your computer)

Open a terminal and run:

```bash
npm install -g firebase-tools
firebase login
```

This logs you into your Google account that owns the Firebase project.

---

## Step 4 — Install function dependencies

Navigate to the `Calendar/functions` folder and install packages:

```bash
cd /path/to/Calendar/functions
npm install
```

---

## Step 5 — Store your Freshbooks credentials securely in Firebase

Run these two commands, replacing the placeholders with your actual values:

```bash
firebase functions:config:set freshbooks.client_id="YOUR_FRESHBOOKS_CLIENT_ID"
firebase functions:config:set freshbooks.client_secret="YOUR_FRESHBOOKS_CLIENT_SECRET"
```

These are stored encrypted server-side in Firebase — they never appear in your
code or GitHub repo.

Verify with:

```bash
firebase functions:config:get
```

---

## Step 6 — Deploy the functions

From the `Calendar` folder (one level above `functions`):

```bash
firebase deploy --only functions
```

You should see output like:

```
✔  functions[freshbooksCallback]: http trigger deployed
✔  functions[freshbooksApi]: callable trigger deployed
```

---

## Step 7 — Update Firebase Security Rules

In **Firebase Console → Realtime Database → Rules**, add the `freshbooks`
section so only the super admin can read the token data from the frontend:

```json
{
  "rules": {
    ".read": "auth != null && auth.token.email.matches(/.*@coradam\\.com$/)",
    "freshbooks": {
      ".read":  "auth != null && auth.token.email === 'c.nocher@coradam.com'",
      ".write": "auth != null && auth.token.email === 'c.nocher@coradam.com'"
    },
    "users": {
      "$uid": {
        ".write": "auth != null && (auth.token.email === 'c.nocher@coradam.com' || root.child('users').child(auth.uid).child('role').val() === 'super_admin' || auth.uid === $uid || (data.exists() && data.child('email').val() === auth.token.email && data.child('pending').val() === true))"
      }
    },
    "clients": {
      ".write": "auth != null && (auth.token.email === 'c.nocher@coradam.com' || root.child('users').child(auth.uid).child('role').val() === 'super_admin')"
    },
    "entries": {
      "$eid": {
        ".write": "auth != null && (auth.token.email === 'c.nocher@coradam.com' || root.child('users').child(auth.uid).child('role').val() === 'super_admin' || (!data.exists() ? newData.child('userId').val() === auth.uid : data.child('userId').val() === auth.uid))"
      }
    },
    "availability": {
      "$aid": {
        ".write": "auth != null && (auth.token.email === 'c.nocher@coradam.com' || root.child('users').child(auth.uid).child('role').val() === 'super_admin' || (!data.exists() ? newData.child('userId').val() === auth.uid : data.child('userId').val() === auth.uid))"
      }
    }
  }
}
```

Click **Publish**.

---

## Step 8 — Commit and push to GitHub

From the `Calendar` folder:

```bash
git add functions/ firebase.json .firebaserc auditor-calendar.html
git commit -m "Add Freshbooks integration via Firebase Functions"
git push
```

---

## Step 9 — Connect in the app (one-time)

1. Sign in to [planner.coradam.com](https://planner.coradam.com) as
   `c.nocher@coradam.com`
2. Go to **Settings → 🔗 Freshbooks**
3. Enter your **Freshbooks Client ID** → click **Save & Continue**
4. Click **Connect to Freshbooks** — you'll be redirected to Freshbooks to
   authorise
5. After authorising you'll be redirected back with a success message

---

## Daily use

| What | Where |
|------|-------|
| Import Freshbooks clients into planner | Settings → Freshbooks → Load clients → Import |
| Generate monthly estimates | Settings → Freshbooks → pick month → Generate estimates |

**Notes:**
- Only clients that were imported from Freshbooks (with a Freshbooks ID) will
  appear in the estimate generator.
- Estimates are created as **Drafts** in Freshbooks — you can review and send
  them manually.
- Unit cost is set to 0 by default — add your rates directly in Freshbooks.
