# CODEX admin CLI

The terminal equivalent of the `/admin` pages — manage CODEX users and
departments straight from a shell, for onboarding someone before they've
signed in, or when the web app itself isn't reachable. Talks directly to the
Postgres database via `lib/db.js`, bypassing HTTP/session auth entirely —
there's no role-scoping here the way `server.js` has for department admins.
Whoever runs this CLI has full access.

Kept as its own package (separate from the root `package.json`) so
installing it doesn't drag in the web server's dependencies (express,
passport, googleapis, mupdf, etc).

## Commands

```
codex add-user
codex list-users [--department <name>] [--role <role>]
codex set-role <email> <member|department_admin|super_admin>
codex deactivate <email>
codex reactivate <email>
codex add-category
codex delete-category <name>
```

## Setup

The CLI needs a `DATABASE_URL` pointing at the same Postgres instance the
website uses. Create `~/.codex.env` (any machine you install the CLI on,
not just the server) with:

```
DATABASE_URL=postgres://...
```

## Installing

**Homebrew** (once the tap below is set up):

```
brew tap tayC1/codex https://github.com/tayC1/SOPGenerator
brew install tayC1/codex/codex
```

See `../Formula/codex.rb` for the formula itself.

**From a local checkout** (for development on the CLI):

```
cd cli
npm install
npm link
```

Either method puts a `codex` binary on your `PATH`.
