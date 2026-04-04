# Coradam Planner — Security Audit Report
**Date:** 2026-04-04
**Scope:** app.js, index.html, cloudflare-worker.js, database.rules.json, inject_config.py, deploy.yml
**Classification:** CONFIDENTIAL — Internal use only

---

## Executive Summary

The Coradam Planner is a Firebase-backed single-page app handling sensitive commercial data: controller identities, client names, factory relationships, and booking schedules. The application has solid foundations (Google OAuth domain restriction, Firebase security rules, Cloudflare Worker as an API proxy) but carries several vulnerabilities that must be addressed before widening access or treating the data as fully protected.

Five findings are rated **Critical or High**. They require immediate action.

---

## Findings

---

### 🔴 CRITICAL — C1: Arbitrary Code Execution via `new Function()` (app.js, line 135)

**Location:** `Setup.connect()` in `app.js`

```js
cfg = new Function('return (' + clean + ')')();
```

**What it means:** The Firebase config pasted by the user is executed as live JavaScript via `new Function()`, which is functionally equivalent to `eval()`. Any value stored under the `acfg` key in `localStorage` is executed as code on page load. If an attacker can write to `localStorage` (e.g., via an XSS in another tab on the same origin, or via physical/browser access), they can achieve arbitrary JavaScript execution inside the planner.

**Immediate risk:** Credential theft, data exfiltration, session hijacking.

**Fix:** Parse the config using `JSON.parse()` only. The Firebase config object is always strict JSON. If users paste a JS-style object (unquoted keys), provide a clear error message asking for the JSON format instead.

---

### 🔴 CRITICAL — C2: Setup Instructions Recommend Fully Open Database Rules (index.html, line 49)

**Location:** Setup screen, step 5

```
{ "rules":{".read":true,".write":true} }
```

**What it means:** The onboarding wizard explicitly instructs new users to publish Firebase Realtime Database rules that allow **anyone on the internet** — including unauthenticated users — to read and write all data. This is the default Firebase warning state. Any user who follows step 5 literally exposes the entire database (all bookings, users, clients, factories) publicly with no authentication required.

**Immediate action required:** Remove this instruction from the setup screen entirely. The correct `database.rules.json` already exists in the repository and should be deployed via `firebase deploy --only database` from the start. The setup instructions should point users to deploy these rules, not to open them.

---

### 🔴 HIGH — H1: Hardcoded Super-Admin Email Exposed in Client-Side Source (app.js, line 5)

**Location:** Top of `app.js` and `cloudflare-worker.js`

```js
const SUPER_ADMIN = 'c.nocher@coradam.com';
```

**What it means:** The super-admin's email address is visible to anyone who opens browser DevTools or views the page source. This directly identifies the highest-privilege account and the individual responsible for the system. Combined with any social engineering or phishing attack, this is a meaningful risk.

**Fix:** Remove the constant from client-side code. The role check for admin routing should rely on the `role` field stored in Firebase (which is set server-side from a trusted source), not on a client-side email comparison. The Cloudflare Worker comparison is appropriate since it runs server-side; the client-side one is the concern.

---

### 🔴 HIGH — H2: All Clients, Factories, and Business Relationships Hard-Coded in Source Code (app.js, lines 1227–1262)

**Location:** `Sett.bulkImport()` in `app.js`

**What it means:** The `bulkImport()` function contains a complete, hardcoded list of all Coradam clients (34 brands including LVMH, Chanel, Tiffany, Prada, De Beers, etc.) and their associated factory suppliers. This is sensitive commercial intelligence. It is permanently stored in the public GitHub repository and visible to anyone with repository access or to anyone using browser DevTools on the live site.

**This constitutes a confidentiality breach** for data covered by NDA agreements with these luxury brands.

**Fix:** Remove the hardcoded list from `app.js` immediately. Import data should be loaded from a private source (a Firebase node accessible only to the super-admin, or an admin-only API endpoint), never embedded in client-facing JavaScript. A CSV import feature is a safer alternative.

---

### 🔴 HIGH — H3: `unsafe-inline` in Content Security Policy Undermines XSS Protection (index.html, lines 14–24)

**Location:** `<meta http-equiv="Content-Security-Policy">`

```
script-src 'self' 'unsafe-inline' ...
style-src 'self' 'unsafe-inline';
```

**What it means:** The CSP is supposed to be the last line of defence against Cross-Site Scripting. Allowing `unsafe-inline` for scripts means any injected inline `<script>` tag or `onclick` attribute will execute freely, completely neutralising the script-src directive. Combined with the `new Function()` issue (C1), this creates compounding risk.

**Fix:** Move all inline JavaScript into `app.js` (already done for most logic). Replace all `onclick="..."` HTML attributes with `addEventListener` calls in `app.js`. Then remove `unsafe-inline` from `script-src`. For styles, use a separate `style.css` file (already linked) and remove `unsafe-inline` from `style-src` as well, or use a hash-based approach.

---

### 🟠 MEDIUM — M1: Firebase Config Stored in Plaintext in localStorage (app.js, lines 69–74)

**Location:** `LS.getCfg()` / `LS.setCfg()`

**What it means:** The Firebase `apiKey`, `databaseURL`, `projectId`, and other identifiers are stored unencrypted in `localStorage`. While Firebase API keys are semi-public by design (they identify the project, not authenticate the user), the full config in localStorage is accessible to any script running on the same origin, and is visible to anyone with browser access to the machine.

**Risk level:** Moderate. Firebase security rules and Google OAuth mitigate the most severe consequences, but the stored config can be read by XSS payloads and extends the attack surface.

**Fix:** Since the config is already injected at build time via `inject_config.py` into `app.js` as `__FIREBASE_CONFIG__`, the localStorage fallback is only needed for the manual setup flow. Consider whether the setup screen is still needed at all once the CI/CD injection is in place. If it is, add a note that the config stored in localStorage is not a secret credential.

---

### 🟠 MEDIUM — M2: Admin Role Assigned and Written Client-Side on Every Login (app.js, lines 230, 248, 254)

**Location:** `App.init()` → `fauth.onAuthStateChanged()`

```js
role: email === SUPER_ADMIN ? 'super_admin' : 'controller'
```

**What it means:** The `role` field is set in the database by the client on every login. The database write rules currently allow a user to write their own profile (`auth.uid === $uid`). Although the email comes from the verified Google token and cannot be spoofed, the pattern of a client writing its own privilege level is architecturally fragile. If the database rules are ever loosened or if an edge case is introduced, privilege escalation becomes possible.

**Fix:** Set the `role` field only once at account creation, and add a Firebase rule that prevents a controller from changing their own `role` field. Example rule:
```json
"role": {
  ".write": "auth.token.email === 'admin@coradam.com'"
}
```

---

### 🟠 MEDIUM — M3: Firebase Token Verification in Cloudflare Worker Uses `accounts:lookup`, Not JWT Signature Verification (cloudflare-worker.js, lines 168–178)

**Location:** `verifyFirebaseToken()` in `cloudflare-worker.js`

**What it means:** The worker verifies Firebase ID tokens by calling the `accounts:lookup` REST endpoint, which checks if the token is valid in Firebase's backend but does not cryptographically verify the JWT signature locally. If Firebase's servers are unreachable or the request is somehow intercepted, this check could fail silently (returning `null` and blocking access, which is the safe failure mode — but a misconfigured catch could allow bypass). It also means the API key is embedded in the request URL, making it visible in Cloudflare logs.

**Fix:** Use proper JWT verification with Firebase's public keys (available at `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`). The Cloudflare Workers environment supports the `crypto.subtle` API for this purpose.

---

### 🟠 MEDIUM — M4: `wipeAll()` Has No Second Confirmation or Audit Trail (app.js, lines 1281–1290)

**Location:** `Sett.wipeAll()`

**What it means:** A single `confirm()` dialog is the only protection before permanently deleting all users, clients, bookings, and availability rules from the database. There is no second factor, no typed confirmation string, no audit log of who triggered the wipe, and no backup mechanism.

**Fix:** Require the admin to type a confirmation phrase (e.g., "WIPE ALL DATA") before proceeding. Log the wipe event (timestamp, user email) to a separate Firebase node before executing. Consider adding a soft-delete or export-before-wipe step.

---

### 🟠 MEDIUM — M5: GitHub Actions Deployment Uses Blacklist Exclusion Instead of Whitelist (deploy.yml, line 32)

**Location:** `.github/workflows/deploy.yml`

```yaml
exclude_assets: '.github,inject_config.py,functions,firebase.json,...'
```

**What it means:** The deployment publishes the entire repository directory (`publish_dir: ./`) and excludes known-sensitive files. This blacklist approach means any new sensitive file added to the repo (e.g., a `.env` file, a config with secrets, a private note) will be automatically published to GitHub Pages if it is not explicitly added to the exclusion list.

**Fix:** Change to a whitelist approach. Create a dedicated `dist/` or `public/` directory and copy only the files that should be public into it before deploying. Publish only that directory.

---

### 🟡 LOW — L1: Debug `console.log` Statements in Production (app.js, lines 161–162)

**Location:** `Auth.signIn()`

```js
console.log('Google sign-in clicked');
console.log('fauth exists?', !!fauth);
```

**What it means:** These statements expose internal authentication state information in the browser console, which is visible to anyone with DevTools open. They also indicate development/debugging artefacts that should not be in a production build.

**Fix:** Remove all debug `console.log` statements before each production release. Use a build step or eslint rule to catch these automatically.

---

### 🟡 LOW — L2: `.DS_Store` File Committed to Repository

**Location:** Repository root and `.github/` directory

**What it means:** `.DS_Store` is a macOS metadata file that can reveal directory structure, file names, and folder organisation to anyone with repository access. It is harmless in a private repo but is a hygiene issue.

**Fix:** Add `.DS_Store` to `.gitignore` and remove the existing committed versions with `git rm --cached .DS_Store`.

---

### 🟡 LOW — L3: Error Messages Returned Verbatim to Client from Cloudflare Worker (cloudflare-worker.js, line 160)

**Location:** `handleApi()` catch block

```js
return jsonResponse({ error: e.message }, 500, cors);
```

**What it means:** Internal error messages (which may include stack traces, Freshbooks API error details, or KV storage errors) are returned directly to the authenticated client. While only the super-admin can reach this endpoint, it is still best practice not to expose raw error strings externally.

**Fix:** Log the full error server-side (Cloudflare Workers supports `console.error` which logs to the Cloudflare dashboard), and return a generic message to the client: `"An internal error occurred. Please try again."`.

---

## Firebase Database Rules — Assessment

The deployed `database.rules.json` is **well-structured** and correctly implements:

- Read access restricted to authenticated `@coradam.com` accounts only
- Freshbooks data restricted to super-admin read/write
- Entry and availability writes restricted to the owning user's UID
- Client writes restricted to super-admin

**One gap identified:** There is no root-level `.write` rule, which means Firebase falls back to denying writes by default for paths not covered. This is correct and safe. However, it should be documented explicitly to avoid accidental relaxation.

**Recommendation:** Add a comment-style document (Firebase rules don't support comments natively, but maintain a `database.rules.md` alongside) explaining the intent of each rule for future maintainers.

---

## Data Confidentiality — Summary

| Data Type | Where Stored | Access Control | Risk |
|---|---|---|---|
| User emails / names | Firebase + localStorage (profile cache) | Auth required, domain-restricted | Low |
| Client names & factories | Firebase + **hardcoded in app.js** | Firebase: auth-restricted / **Code: public** | **HIGH** |
| Booking records | Firebase `entries/` | Auth + ownership rules | Low |
| Availability rules | Firebase `availability/` | Auth + ownership rules | Low |
| Freshbooks OAuth tokens | Cloudflare KV | Super-admin only | Low |
| Firebase config | localStorage + GitHub Secret | Anyone with browser access | Medium |

---

## Priority Action Plan

| Priority | Action | Effort |
|---|---|---|
| 🔴 Immediate | Remove hardcoded client/factory list from `app.js` | 1 hour |
| 🔴 Immediate | Remove "open rules" instruction from setup screen | 30 min |
| 🔴 Immediate | Replace `new Function()` with `JSON.parse()` | 1 hour |
| 🔴 Short-term | Remove `SUPER_ADMIN` constant from client-side code | 2 hours |
| 🔴 Short-term | Remove `unsafe-inline` from CSP | 2–4 hours |
| 🟠 Short-term | Add Firebase rule to prevent self-role-escalation | 1 hour |
| 🟠 Short-term | Switch deploy to whitelist-only approach | 1 hour |
| 🟠 Short-term | Add typed confirmation and audit log to `wipeAll()` | 2 hours |
| 🟠 Medium-term | Implement JWT signature verification in Cloudflare Worker | 3 hours |
| 🟡 Low-priority | Remove debug console.log statements | 30 min |
| 🟡 Low-priority | Add `.DS_Store` to `.gitignore` | 10 min |
| 🟡 Low-priority | Sanitise error messages in Cloudflare Worker | 30 min |

---

## Security Protocols Going Forward

### Code Review
- All changes to `app.js`, `database.rules.json`, and `cloudflare-worker.js` must be reviewed before merging to `main`.
- No Firebase config, API keys, secrets, or credentials should ever appear in committed code.

### Secrets Management
- `FIREBASE_CONFIG` and `FRESHBOOKS_CLIENT_SECRET` must remain GitHub Secrets only.
- Rotate the Freshbooks client secret if there is any suspicion it has been exposed.
- The Firebase API key is semi-public by design but treat it as sensitive to limit abuse.

### Access Control
- Maintain the `@coradam.com` domain restriction as the first line of authentication.
- Review the list of controllers with active access quarterly.
- Super-admin access should be held by as few people as possible.

### Data Handling
- Client names, factory names, and booking data are **commercially confidential** and covered by NDA agreements. They must not be embedded in client-side code, committed to any repository (public or private), or transmitted outside Firebase/Cloudflare infrastructure.
- CSV exports from the admin dashboard contain sensitive data. Exports should be treated as confidential documents.

### Incident Response
- If the Firebase database is suspected of unauthorised access: immediately change Database Rules to `".read": false, ".write": false` in the Firebase console, then investigate.
- If a controller account is compromised: deactivate the user profile in Settings → Controllers and revoke their Google account access.

---

*This report is classified CONFIDENTIAL. Do not share outside authorised personnel.*
