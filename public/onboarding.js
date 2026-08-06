// First-run "Get Started" product tour, shown automatically the first time
// a signed-in user loads any app page (tracked server-side via
// users.onboarding_seen_at, so it's per-account and survives across
// browsers/devices, and also fires once for existing users after this
// column was added since it starts out NULL for everyone).
//
// Same shared-script convention as saved.js/markdown.js - included via
// <script src="/onboarding.js"> on every app-shell page instead of
// duplicating the modal markup into each one.
//
// Any element with the data-codex-onboarding-trigger attribute (the
// sidebar "Get Started" link) re-opens the tour on demand, regardless of
// whether it's already been seen.
const CodexOnboarding = (() => {
  const EXTENSION_URL = 'https://chromewebstore.google.com/detail/codex/capicbafpiflgbopfcklobgdebodigmb';

  const STEPS = [
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
      title: 'Welcome to CODEX',
      body: 'Your team’s home for SOPs, documents, and know-how. Here’s a quick look at what you can do.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
      title: 'Capture SOPs as you work',
      body: 'Install the CODEX Chrome extension to record step-by-step SOPs right from your browser — no screenshots or manual write-ups needed.',
      link: { label: 'Install Chrome Extension', href: EXTENSION_URL },
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
      title: 'Find what you need fast',
      body: 'Browse your dashboard, search by keyword, or open a department’s category page to see everything your team has documented.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>',
      title: 'Pin your go-to SOPs',
      body: 'Save any SOP or document to your Saved list for one-click access whenever you need it again.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
      title: 'Contacts & feedback',
      body: 'Look up teammates in Contacts, and drop us a note on the Feedback page any time you spot a bug or have an idea.',
    },
  ];

  let overlayEl = null;
  let stepIndex = 0;

  function injectStyles() {
    if (document.getElementById('codexOnboardingStyles')) return;
    const style = document.createElement('style');
    style.id = 'codexOnboardingStyles';
    style.textContent = `
      .codex-ob-overlay {
        position: fixed; inset: 0; z-index: 1000;
        background: rgba(0, 0, 0, 0.6);
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .codex-ob-card {
        position: relative;
        width: 100%; max-width: 440px;
        background: #2d2b2e;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        padding: 40px 32px 28px;
        color: #ffffff;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      }
      .codex-ob-skip {
        position: absolute; top: 16px; right: 18px;
        background: none; border: none;
        color: rgba(255, 255, 255, 0.45);
        font-family: inherit; font-size: 12.5px; font-weight: 600;
        cursor: pointer;
      }
      .codex-ob-skip:hover { color: #ffffff; }
      .codex-ob-icon { width: 52px; height: 52px; margin: 0 auto 18px; color: #e96d2d; }
      .codex-ob-icon svg { width: 100%; height: 100%; }
      .codex-ob-title { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
      .codex-ob-body { font-size: 14px; line-height: 1.55; color: rgba(255, 255, 255, 0.65); margin-bottom: 18px; }
      .codex-ob-link {
        display: inline-block; font-size: 13px; font-weight: 600;
        color: #7eb8d4; text-decoration: underline; margin-bottom: 20px;
      }
      .codex-ob-dots { display: flex; justify-content: center; gap: 6px; margin-bottom: 22px; }
      .codex-ob-dot { width: 6px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.2); }
      .codex-ob-dot.is-active { background: #e96d2d; width: 18px; }
      .codex-ob-actions { display: flex; justify-content: space-between; gap: 12px; }
      .codex-ob-btn {
        flex: 1; border-radius: 8px; padding: 10px 18px;
        font-family: inherit; font-size: 14px; font-weight: 600;
        border: none; cursor: pointer;
      }
      .codex-ob-btn-ghost { background: none; border: 1px solid rgba(255, 255, 255, 0.15); color: #ffffff; }
      .codex-ob-btn-ghost:hover { border-color: rgba(255, 255, 255, 0.3); }
      .codex-ob-btn-ghost:disabled { visibility: hidden; }
      .codex-ob-btn-primary { background: #2e5266; color: #ffffff; }
      .codex-ob-btn-primary:hover { opacity: 0.88; }
    `;
    document.head.appendChild(style);
  }

  async function markSeen() {
    try {
      await fetch('/auth/onboarding-seen', { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.error('[onboarding] failed to mark seen:', err);
    }
  }

  function close() {
    if (!overlayEl) return;
    document.removeEventListener('keydown', onKeydown);
    overlayEl.remove();
    overlayEl = null;
    markSeen();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  function renderStep() {
    const step = STEPS[stepIndex];
    const isLast = stepIndex === STEPS.length - 1;
    const card = overlayEl.querySelector('.codex-ob-card');
    card.innerHTML = `
      <button class="codex-ob-skip" type="button" data-action="skip">Skip</button>
      <div class="codex-ob-icon">${step.icon}</div>
      <h2 class="codex-ob-title">${step.title}</h2>
      <p class="codex-ob-body">${step.body}</p>
      ${step.link ? `<a class="codex-ob-link" href="${step.link.href}" target="_blank" rel="noopener">${step.link.label}</a>` : ''}
      <div class="codex-ob-dots">
        ${STEPS.map((_, i) => `<span class="codex-ob-dot${i === stepIndex ? ' is-active' : ''}"></span>`).join('')}
      </div>
      <div class="codex-ob-actions">
        <button class="codex-ob-btn codex-ob-btn-ghost" type="button" data-action="back"${stepIndex === 0 ? ' disabled' : ''}>Back</button>
        <button class="codex-ob-btn codex-ob-btn-primary" type="button" data-action="next">${isLast ? 'Get started' : 'Next'}</button>
      </div>
    `;
    card.querySelector('[data-action="skip"]').addEventListener('click', close);
    card.querySelector('[data-action="back"]').addEventListener('click', () => {
      if (stepIndex > 0) { stepIndex -= 1; renderStep(); }
    });
    card.querySelector('[data-action="next"]').addEventListener('click', () => {
      if (stepIndex === STEPS.length - 1) { close(); return; }
      stepIndex += 1;
      renderStep();
    });
  }

  function open() {
    if (overlayEl) return;
    injectStyles();
    stepIndex = 0;
    overlayEl = document.createElement('div');
    overlayEl.className = 'codex-ob-overlay';
    overlayEl.innerHTML = '<div class="codex-ob-card"></div>';
    document.body.appendChild(overlayEl);
    document.addEventListener('keydown', onKeydown);
    renderStep();
  }

  async function maybeAutoShow() {
    try {
      const res = await fetch('/auth/me', { credentials: 'include' });
      const data = await res.json();
      if (data.user && !data.user.onboarding_seen_at) open();
    } catch (err) {
      console.error('[onboarding] auto-show check failed:', err);
    }
  }

  function wireTriggers() {
    document.querySelectorAll('[data-codex-onboarding-trigger]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        open();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireTriggers);
  } else {
    wireTriggers();
  }
  maybeAutoShow();

  return { open };
})();
