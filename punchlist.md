# CODEX — Punch List

_Last updated: 2026-07-07_

## Next Steps 
- [ ] Finish front end designs 
- [ ] confirm all prod additions 
- [ ] figure out how to make sure that versions are tracked and all that good stuff



## 🔐 Auth & security

- [ ] Confirm Google OAuth login works end-to-end in production (not just local `localhost:3000` testing), including the Kramer Pro workspace domain restriction.
- [ ] Verify Railway env vars are all correctly set in prod: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `BASE_URL`, `DATABASE_URL`.
- [ ] Confirm the Google Cloud Console redirect URI matches the live Railway domain (not just the localhost callback).
- [ ] Decide on longer-term session/JWT secret rotation policy now that it's a real login system, not just a demo.

## ⚙️ Infrastructure / Railway

- [ ] Confirm `express.json({ limit: '50mb' })` body size fix is deployed (fixes base64 screenshot payload rejection).
- [ ] Set up structured logging / deploy-failure alerting (Slack webhook or UptimeRobot) — currently console.log-level only.
- [ ] Decide on deploy access governance as the team grows past 12 — right now you're the only one with Railway access.
- [ ] Confirm migrations run automatically on deploy (`npm run migrate:up && node server.js`) rather than needing manual intervention.

## 📦 Distribution

- [ ] Decide on Chrome Web Store path: pay the $5 dev fee for unlisted distribution (cleanest, auto-updates) vs. self-hosted `.crx` vs. staying on manual "Load unpacked" sideloading.
- [ ] If going the Web Store route, budget for review time — broad-permission extensions can take a few weeks to clear review.

## 🏗️ Scope expansion (warehouse/company-wide)

- [ ] Decide: is CODEX staying finance/admin-only (Chrome extension, desktop), or expanding company-wide to warehouse/ops on iPad?
- [ ] If expanding to iPad: choose between a Safari extension rebuild (medium-high effort), a native app with ReplayKit screen capture (high effort, App Store submission), or simpler photo-based step capture.
- [ ] If warehouse SOPs are in scope, design accordingly — more visual/less text, larger images, safety callouts, possibly printable/laminated versions.

## ✨ Feature backlog

- [ ] Pause/resume recording
- [ ] Keyboard input recording
- [ ] Form field detection / auto-fill suggestions
- [ ] Multiple workflow templates
- [ ] Optional cloud sync
- [ ] PDF export format
- [ ] Collaborative SOP sharing

---

© 2026 Taylor Giba. All rights reserved.