# CODEX

**Live site:** [kpcodex-production.up.railway.app](https://kpcodex-production.up.railway.app)

A full-featured Knowledge Base/SOP builder built for Kramer Pro. CODEX has two halves that work together:

- **A Chrome Extension** that records clicks and screenshots as you work, then lets you turn that recording into a polished, editable SOP.
- **A web app** (hosted on Railway) where signed-in teammates browse the knowledge base, view SOPs by team, manage their profile, and — for admins — assign departments and edit team pages.

Signing in (via Google, restricted to `kramer.pro` Workspace accounts) links the two together: SOPs you record and publish from the extension show up on the website under your account and your team's page, and vice versa.

## Features

**Recording (extension)**
- ✅ Click recording with metadata (element text, tag, page title, URL)
- ✅ Screenshot after every click, with a visual "Recording…" indicator while active
- ✅ Recording state survives the browser killing the extension's service worker mid-session — nothing is lost to Chrome's idle timeout
- ✅ Rich review/edit UI — reorder, delete, insert warnings/tips/flags/manual steps anywhere, auto-generated title & summary
- ✅ Built-in screenshot editor — redact, blur, crop, or reposition the click marker before publishing
- ✅ Publish straight to the knowledge base, or export as a standalone Markdown file

**Knowledge base (website)**
- ✅ Google Workspace sign-in (`kramer.pro` accounts only), bridged automatically into the extension
- ✅ Dashboard of your own SOPs, filterable by category
- ✅ Per-team pages: description, important links, team lead, member list, and that team's SOPs
- ✅ Public "Browse" gallery of every SOP, no sign-in required
- ✅ A given SOP can be edited later (steps, screenshots, title, category) and re-saved in place
- ✅ Settings page: edit your profile, set a default category, see your teammates, invite new people by email
- ✅ Admin portal: assign users to (multiple) departments, edit each team's lead/description/links

## Getting Started (for beta testers)

1. **Confirm you have a `kramer.pro` Google account.** Sign-in is restricted to the Workspace domain — a personal Gmail account will be rejected.
2. **Install the extension:**
   - Download **[codex.crx](https://kpcodex-production.up.railway.app/extension/codex.crx)**
   - Go to `chrome://extensions/`
   - Enable **Developer mode** (top-right toggle) — required to sideload a `.crx` that isn't from the Chrome Web Store
   - Drag the downloaded `codex.crx` file onto the `chrome://extensions/` page and confirm **Add extension** when prompted
   - The CODEX icon appears in your toolbar
3. **Sign in on the website:** visit [kpcodex-production.up.railway.app](https://kpcodex-production.up.railway.app) and sign in with Google. This automatically links your session to the extension — you don't sign in separately inside the extension itself.
4. You're set up. The extension talks to the same hosted backend everyone else uses, so there's no local server to run and no config to edit.

**Updates happen automatically.** The extension is built with `update_url` pointing at our hosted update manifest, so Chrome periodically checks it in the background and pulls new versions on its own — no manual re-download or reload needed. Chrome's check interval isn't instant (typically a few hours), so if you need a specific fix *right now*, you can force it: `chrome://extensions/` → enable Developer mode → **Update** button at the top of the page.

> If your organization has CODEX force-installed via Google Admin Console instead, none of the above applies to you — it's already installed and stays updated automatically, with no Developer Mode banner at all.

> Note: since this isn't published to the Chrome Web Store, Chrome will show a permanent "Developer mode extensions" banner and a broad site-access permission prompt on install. This is expected for a sideloaded extension and not a sign of anything being broken.

## Beta

CODEX is in active beta — things will change, and you may run into rough edges. If you hit a bug, something looks broken, or a feature doesn't behave the way you'd expect:

- Open an issue on the [GitHub Issues page](https://github.com/tayC1/SOPGenerator/issues)
- Include what you were doing, what you expected to happen, and what actually happened — a screenshot helps a lot

That's the one place to report anything, big or small.

## Usage

### Recording a workflow

1. Click the CODEX icon to open the popup
2. Click **Record** to begin
3. A red "Recording…" indicator appears in the top-right corner
4. Proceed through the workflow as normal — each click is captured
5. Click **Stop & Review** when finished

### Reviewing and editing

A new tab opens with every captured step. From there you can:
- Edit the auto-generated title/summary, or regenerate them from the current steps
- Edit any step's description inline
- Insert a warning, tip, flag, or manual step at any point (hover the thin line between steps)
- Open the screenshot editor on any step to redact, blur, crop, or move the click marker
- Delete steps you don't want

### Publishing to the knowledge base

From the Export ▾ menu, choose **Push to Codex** — pick a category, and it uploads to the backend under your account, tagged to that team. You need to be signed in on the website first (see Getting Started); if you're not, you'll get a prompt to sign in instead.

Prefer a plain file instead? **Download as .MD** exports a standalone Markdown file with screenshots embedded inline — nothing is uploaded.

### Editing a published SOP

From your dashboard, click **EDIT** on any SOP you own. It reopens the same rich editor (now titled "Edit Steps") with that SOP's existing steps loaded — the Export menu is replaced with a single **Save** button that updates that SOP in place instead of creating a new one.

### Browsing the knowledge base

- **My Dashboard** — your own SOPs, filterable by category
- **Team pages** (`/team/<name>`) — a given team's description, links, lead, members, and SOPs
- **Browse** — every published SOP, publicly viewable, no sign-in required
- **Settings** — your profile, default category, teammates, and invites
- **Admin Portal** (admins only) — assign departments to users, edit team descriptions/leads/links

## Architecture

```
extension/                         Backend (Railway)
├── manifest.json                  ├── server.js       (Express, routes, sessions)
├── background.js  (service worker)├── auth.js          (Google OAuth, Workspace-restricted)
├── content.js      (click capture)├── db.js            (Postgres connection)
├── popup.html/js   (record UI)    ├── schema.sql       (idempotent migrations)
├── review.html                    ├── routes/sops.js   (SOP CRUD)
├── scale.js        (review/edit UI, screenshot editor, publish/save)
├── config.js        (points at the hosted backend URL)
└── Icons/            (copy of root Icons/, also served by the backend at /icons)

Website (public/)                  Admin tooling
├── index.html       (landing / sign-in)
├── welcome.html      (post-sign-in onboarding)
├── dashboard.html    (My SOPs)
├── teamlanding.html  (per-team page)
├── sop.html          (single SOP view)
├── browse.html       (public gallery)
├── settings.html     (profile / teammates / invites)
└── admin.html         (department + team page management)   scripts/import-google-users.js
                                                                (one-off Workspace directory import)
```

### How sign-in reaches the extension

The extension has no sign-in UI of its own. Instead: you sign in on the website via Google OAuth (session cookie), the website requests a token via `/auth/extension-token`, then hands it to the extension with `chrome.runtime.sendMessage` (allowed via `externally_connectable` in `manifest.json`, scoped to the production domain). The extension stores that token and attaches it as a Bearer token on every API call from then on. Signing out on the website also tells the extension to forget it.

## Troubleshooting

**Sign-in fails with "workspace_required"**
- You need a `kramer.pro` Google Workspace account — personal Gmail accounts are rejected by design.

**Extension shows "Please sign in" when trying to publish**
- Sign in on the website first (see Getting Started) — the extension picks up the session automatically. If you were already signed in and it's still not picking it up, try reloading the extension at `chrome://extensions`.

**Recording isn't working**
- Confirm the extension has permission to run on the site
- Try refreshing the page after clicking Record
- Check the page's developer console for errors

**Screenshots are black or blank**
- Can happen on protected pages (banking sites, etc.) due to Chrome's screenshot restrictions

**Review page won't open**
- Confirm at least one step has been captured
- Check that pop-ups aren't blocked for the extension

## Security & privacy

- Sign-in is restricted to `kramer.pro` Google Workspace accounts
- Recorded steps and screenshots are stored locally in `chrome.storage.local` until you publish — publishing sends them to the hosted backend under your account, where they're stored in Postgres and become visible per the SOP's team/category
- The extension only ever captures tabs you're actively recording in, never in the background
- You can clear an in-progress recording at any time from the popup

## Limitations

- Cannot record clicks on Chrome UI elements or other extensions
- Sites with strict CSP (Content Security Policy) may block recording
- Screenshot capture is subject to Chrome's built-in restrictions
- Not published to the Chrome Web Store yet — install by sideloading the packed `.crx` (see Getting Started)

## Future enhancements

Planned or potential additions:
- Pause/resume recording
- Keyboard input recording
- Chrome Web Store distribution
- PDF export format
- iPad/warehouse-floor support

---

**Built to streamline SOP documentation. 📋**

## Copyright

© 2026 Taylor Giba. All rights reserved.
