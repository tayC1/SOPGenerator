# CODEX Slack app

Adds a `/codex` slash command so Kramer Pro employees can search SOPs and
share them into a channel without leaving Slack — a `/giphy`-style flow on
top of the existing CODEX backend. Does not touch the Chrome extension.

## How it works

- `/codex <query>` → `POST /slack/commands` → verifies the request came from
  Slack → resolves the invoking Slack user's email (`users.info`) → maps it
  to a CODEX account by email → runs a Postgres `ILIKE` search across
  `title`, `description`, `content`, `tag` → responds with an **ephemeral**
  Block Kit message (only the invoking user sees it) showing up to 8
  results, each with **Share to channel** and **Open in CODEX** buttons.
- **Share to channel** → `POST /slack/interactions` → verifies the request →
  re-fetches that SOP → posts a public message to the channel via the
  interaction's `response_url` (`response_type: in_channel`).
- **Open in CODEX** is a plain link button to `{CODEX_BASE_URL}/sop.html?id=...`.

## Known scope gap

Search is **workspace-wide**, not scoped by the requester's CODEX
department/ownership the way `GET /sops` and `canRead()` are
(`routes/sops.js`). Any `@kramer.pro` Slack user with a linked CODEX account
can find any SOP via `/codex`, including ones marked private or scoped to a
department they're not in. This was an explicit choice for v1 (see
`lib/sopSearch.js`) — tighten it later by filtering results to the mapped
user's `user_departments` + `is_public` if that gap needs closing.

A Slack user with no matching CODEX account (by email) is told to sign in
at `CODEX_BASE_URL` first; `/codex` does nothing further for them until they
do.

## Env vars

| Var | Description |
| --- | --- |
| `SLACK_SIGNING_SECRET` | From the Slack app's **Basic Information** page. Used to verify `X-Slack-Signature` on both endpoints. |
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-...`) from **OAuth & Permissions**, after installing the app. Used to call `users.info`. |
| `CODEX_BASE_URL` | Public base URL of this deployment (e.g. `https://codex.kramer.pro`), used to build deep links and the sign-in prompt. Falls back to the existing `BASE_URL` env var if unset. |

Set these in Railway's environment variables for this service — same as the
existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/etc. Never commit them.

## Installing the Slack app

1. Go to <https://api.slack.com/apps> → **Create New App** → **From an app manifest**.
2. Pick the Kramer Pro workspace, paste in `slack-manifest.yml` from the repo root.
3. If testing against something other than `codex.kramer.pro` (e.g. a
   Railway preview or an ngrok tunnel), edit the two `url`/`request_url`
   fields in the manifest before creating the app — or install it as-is and
   change them under **Slash Commands** / **Interactivity & Shortcuts**
   afterward.
4. **Install to Workspace** (under **OAuth & Permissions**) — this generates
   the bot token (`SLACK_BOT_TOKEN`).
5. Copy the **Signing Secret** from **Basic Information** → `SLACK_SIGNING_SECRET`.
6. Set both plus `CODEX_BASE_URL` in Railway and redeploy.

## Local testing with ngrok

1. `npm start` (runs on `PORT`, default 3000).
2. In another terminal: `ngrok http 3000`, copy the `https://*.ngrok-free.app` URL it prints.
3. In the Slack app config:
   - **Slash Commands** → edit `/codex` → Request URL: `https://<ngrok-url>/slack/commands`
   - **Interactivity & Shortcuts** → Request URL: `https://<ngrok-url>/slack/interactions`
4. Set `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, and `CODEX_BASE_URL=http://localhost:3000`
   (or the ngrok URL, if you want deep links to work through the tunnel too)
   in your local `.env`, then restart the server.
5. In Slack, run `/codex some search term` in any channel the app has been
   added to. Check the server logs for `[slack]`-prefixed lines if something
   doesn't respond.

Note: ngrok URLs change on every restart of the free tier — you'll need to
update both Request URLs in the Slack app config each time you get a new one.
