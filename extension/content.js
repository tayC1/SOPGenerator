// Content script for Scribe Clone

// --- Web-app <-> extension auth bridge (postMessage relay) -------------
// dashboard.html's primary path for handing off a signed-in session (or an
// EDIT_SOP request) is chrome.runtime.sendMessage(extensionId, ...) via
// manifest.json's externally_connectable, which only Chrome supports. As a
// fallback - and the only path on Safari, which has no externally_connectable
// equivalent - the web app also posts the same message shape to window;
// relay it into background.js exactly as onMessageExternal would.
//
// This script runs on <all_urls> (needed for SOP-capture recording on
// arbitrary sites), so an untrusted page must never be able to drive the
// extension through this listener - only messages whose event.origin is one
// of CODEX's own web origins, carrying our own envelope marker, are relayed.
const TRUSTED_BRIDGE_ORIGINS = [
  'https://codex.kramer.pro',
  'https://kpcodex-production.up.railway.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!TRUSTED_BRIDGE_ORIGINS.includes(event.origin)) return;
  const data = event.data;
  if (!data || data.source !== 'codex-web' || !data.type || !data.requestId) return;

  chrome.runtime.sendMessage(data, (response) => {
    window.postMessage({
      source: 'codex-extension',
      requestId: data.requestId,
      response: response || null,
      error: chrome.runtime.lastError ? chrome.runtime.lastError.message : null,
    }, event.origin);
  });
});

let isRecording = false;
let recordingOverlay = null;
let activeInputElement = null;
let inputStartValue = '';

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    isRecording = true;
    createRecordingOverlay();
    attachClickListener();
    attachKeyListeners();
    sendResponse({ status: 'recording started on page' });
  }

  if (request.action === 'stopRecording') {
    isRecording = false;
    removeRecordingOverlay();
    removeClickListener();
    removeKeyListeners();
    sendResponse({ status: 'recording stopped on page' });
  }
});

function createRecordingOverlay() {
  if (recordingOverlay) return;

  // Inject keyframe animation once
  if (!document.getElementById('scribe-styles')) {
    const style = document.createElement('style');
    style.id = 'scribe-styles';
    style.textContent = `
      @keyframes scribe-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.25; }
      }
    `;
    document.head.appendChild(style);
  }

  const ff = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  // Root container
  recordingOverlay = document.createElement('div');
  recordingOverlay.id = 'scribe-recording-overlay';
  recordingOverlay.style.cssText = `
    position: fixed; top: 12px; right: 12px;
    z-index: 2147483647;
    font-family: ${ff};
    user-select: none;
  `;

  // Pill button
  const pill = document.createElement('div');
  pill.style.cssText = `
    display: flex; align-items: center; gap: 7px;
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: white; padding: 8px 13px 8px 11px;
    border-radius: 999px; font-size: 13px; font-weight: 600;
    cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.22);
    transition: box-shadow 0.15s;
  `;

  const dot = document.createElement('span');
  dot.style.cssText = `
    width: 8px; height: 8px; background: white; border-radius: 50%;
    flex-shrink: 0; animation: scribe-pulse 1.2s infinite;
  `;

  const label = document.createElement('span');
  label.textContent = 'Recording...';

  const chevron = document.createElement('span');
  chevron.textContent = '▾';
  chevron.style.cssText = 'font-size: 11px; opacity: 0.75; margin-left: 1px; transition: transform 0.2s;';

  pill.appendChild(dot);
  pill.appendChild(label);
  pill.appendChild(chevron);

  // Dropdown panel
  const dropdown = document.createElement('div');
  dropdown.style.cssText = `
    display: none; margin-top: 7px;
    background: white; border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.2);
    overflow: hidden; min-width: 190px;
  `;

  const stepRow = document.createElement('div');
  stepRow.style.cssText = `
    padding: 10px 14px 9px;
    font-size: 12px; font-weight: 600;
    color: rgba(100,100,100,1);
    border-bottom: 1px solid rgba(0,0,0,0.07);
  `;
  stepRow.textContent = '0 steps captured';

  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'Stop & Review';
  stopBtn.style.cssText = `
    display: block; width: 100%; padding: 11px 14px;
    border: none; background: rgba(200,107,102,1);
    color: white; font-size: 14px; font-weight: 700;
    font-family: ${ff}; text-align: center; cursor: pointer;
    transition: opacity 0.15s;
  `;
  stopBtn.onmouseenter = () => { stopBtn.style.opacity = '0.88'; };
  stopBtn.onmouseleave = () => { stopBtn.style.opacity = '1'; };

  stopBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isRecording = false;
    removeRecordingOverlay();
    removeClickListener();
    removeKeyListeners();
    chrome.runtime.sendMessage({ action: 'stopAndReview' });
  });

  dropdown.appendChild(stepRow);
  dropdown.appendChild(stopBtn);

  // Toggle dropdown
  let open = false;
  function toggleDropdown(e) {
    e.stopPropagation();
    open = !open;
    dropdown.style.display = open ? 'block' : 'none';
    chevron.style.transform = open ? 'rotate(180deg)' : '';
    if (open) {
      chrome.storage.local.get('steps', (res) => {
        const n = (res.steps || []).length;
        stepRow.textContent = n + (n === 1 ? ' step captured' : ' steps captured');
      });
    }
  }

  pill.addEventListener('click', toggleDropdown);

  document.addEventListener('click', (e) => {
    if (open && recordingOverlay && !recordingOverlay.contains(e.target)) {
      open = false;
      dropdown.style.display = 'none';
      chevron.style.transform = '';
    }
  }, true);

  recordingOverlay.appendChild(pill);
  recordingOverlay.appendChild(dropdown);
  document.body.appendChild(recordingOverlay);
}

function removeRecordingOverlay() {
  if (recordingOverlay) {
    recordingOverlay.remove();
    recordingOverlay = null;
  }
}

// Attach click listener
function attachClickListener() {
  document.addEventListener('click', captureClick, true);
}

function removeClickListener() {
  document.removeEventListener('click', captureClick, true);
}

function attachKeyListeners() {
  document.addEventListener('keydown', captureKeydown, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('blur', onBlur, true);
}

function removeKeyListeners() {
  document.removeEventListener('keydown', captureKeydown, true);
  document.removeEventListener('focusin', onFocusIn, true);
  document.removeEventListener('blur', onBlur, true);
}

// A click/keystroke often triggers a re-render, navigation, or animation -
// screenshotting on a fixed delay either cuts that short (half-updated page)
// or wastes time waiting past when the page already settled. Instead, watch
// the page and only fire once it actually looks done:
//   - MutationObserver: keep pushing the wait out while the DOM is still
//     changing, so an animation or a slow-rendering framework doesn't get
//     cut short. Settles once mutations stop for SETTLE_QUIET_MS.
//   - <img> completeness: an <img> tag can exist (no further mutations)
//     while its pixels are still streaming in, so mutations alone would
//     miss a half-loaded image.
//   - visualViewport resize: on iPad/iPhone Safari, tapping a link/input
//     often triggers the compact address bar/tab bar to collapse or expand,
//     which resizes the visible viewport with no corresponding DOM mutation.
//     captureVisibleTab can fire mid-animation and grab the strip the bar
//     just vacated before WebKit has repainted it, producing a solid black
//     band at the top of the screenshot. Treat viewport resizes as "still
//     unsettled" the same way DOM mutations are.
//   - SETTLE_MAX_MS hard cap: some pages never fully go quiet (live
//     tickers, polling widgets), so waiting forever isn't an option.
const SETTLE_QUIET_MS = 200;
const SETTLE_MAX_MS = 3000;

function waitForStableCapture(callback) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const start = Date.now();
      let settleTimer = null;
      let done = false;

      const imagesStillLoading = () =>
        Array.from(document.images).some((img) => img.src && !img.complete);

      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', armSettleTimer);
        }
        clearTimeout(settleTimer);
        clearTimeout(hardCap);
        callback();
      };

      const armSettleTimer = () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (imagesStillLoading() && Date.now() - start < SETTLE_MAX_MS) {
            armSettleTimer();
            return;
          }
          finish();
        }, SETTLE_QUIET_MS);
      };

      const observer = new MutationObserver(armSettleTimer);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', armSettleTimer);
      }

      const hardCap = setTimeout(finish, SETTLE_MAX_MS);

      armSettleTimer();
    });
  });
}

function sendCaptureScreenshot(stepData, onDone) {
  chrome.runtime.sendMessage(Object.assign({ action: 'captureScreenshot' }, stepData), (response) => {
    if (onDone) onDone(response);
  });
}

// If the click/keystroke being captured triggers a full page navigation,
// this content script is torn down mid-wait and can never send the
// screenshot itself. Race the settle-detection against `pagehide`: if the
// page starts unloading first, stash the step in storage so the new page's
// content script (see resumePendingCaptureIfAny below) can finish the
// capture once the destination page has loaded and settled.
function captureAfterSettle(stepData, onDone) {
  let navigated = false;
  const onPageHide = () => {
    navigated = true;
    chrome.storage.local.set({ codexPendingCapture: { stepData, savedAt: Date.now() } });
  };
  window.addEventListener('pagehide', onPageHide);

  waitForStableCapture(() => {
    window.removeEventListener('pagehide', onPageHide);
    if (navigated) return; // destination page will finish this capture
    sendCaptureScreenshot(stepData, onDone);
  });
}

function clampText(text, max = 80) {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// The best human-readable name for a form field is the <label> a person
// actually sees, not the input's id/name attribute - those are frequently
// framework-generated (e.g. "input_47", "react-select-2-input") and are
// exactly the kind of "weird field name" that shows up in a captured step
// when there's no label lookup at all.
function nearestLabelText(el) {
  if (!el) return '';
  if (el.id) {
    try {
      const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl?.innerText?.trim()) return labelEl.innerText.trim();
    } catch {
      // invalid id for a CSS selector (rare) - fall through to the other lookups
    }
  }
  const wrappingLabel = el.closest?.('label');
  if (wrappingLabel?.innerText?.trim()) return wrappingLabel.innerText.trim();
  return '';
}

// Shared accessible-name lookup for anything a step needs to describe -
// a typed-into field, a key press target, or a click. A click especially
// often lands on a leaf node with no text of its own (an <svg>/<path>/
// <span> inside an icon button), so it walks up to the nearest actual
// interactive ancestor and prefers that element's accessible name (aria-
// label first, matching how browsers compute accessible names) instead
// of an empty or unrelated leaf value.
function describeElement(el) {
  if (!el) return '';

  if (isTypableInput(el)) {
    const label = nearestLabelText(el);
    return clampText(
      label ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.id ||
      el.tagName.toLowerCase()
    );
  }

  const target = el.closest?.('button, a, [role="button"], summary') || el;
  return clampText(
    target.getAttribute?.('aria-label') ||
    target.innerText?.trim() ||
    target.textContent?.trim() ||
    target.value ||
    target.placeholder ||
    target.getAttribute?.('alt') ||
    target.getAttribute?.('title') ||
    ''
  );
}

function isTypableInput(el) {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || el.isContentEditable) return true;
  if (tag === 'input') {
    const type = (el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(type);
  }
  return false;
}

function onFocusIn(e) {
  if (!isRecording) return;
  const el = e.target;
  if (isTypableInput(el)) {
    activeInputElement = el;
    inputStartValue = el.value !== undefined ? el.value : (el.textContent || '');
  }
}

function onBlur(e) {
  if (!isRecording) return;
  const el = e.target;
  if (el !== activeInputElement || !isTypableInput(el)) return;
  const currentValue = el.value !== undefined ? el.value : (el.textContent || '');
  if (currentValue.trim() && currentValue !== inputStartValue) {
    captureTypedText(el, currentValue);
  }
  activeInputElement = null;
  inputStartValue = '';
}

function captureKeydown(e) {
  if (!isRecording) return;
  const isModifier = e.ctrlKey || e.metaKey || e.altKey;
  const specialKeys = new Set(['Enter', 'Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);

  if (!isModifier && !specialKeys.has(e.key)) return;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

  // Flush pending typed text before recording Enter
  if (e.key === 'Enter' && activeInputElement) {
    const currentValue = activeInputElement.value !== undefined ? activeInputElement.value : (activeInputElement.textContent || '');
    if (currentValue.trim() && currentValue !== inputStartValue) {
      captureTypedText(activeInputElement, currentValue);
      inputStartValue = currentValue;
    }
  }

  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Cmd');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && isModifier) parts.push('Shift');
  parts.push(e.key);
  sendKeyStroke(e.target, parts.join('+'));
}

function captureTypedText(el, value) {
  // Derive the label synchronously, before any render/navigation the
  // blur might trigger has a chance to change or remove this element.
  const label = describeElement(el);
  if (recordingOverlay) recordingOverlay.style.visibility = 'hidden';
  captureAfterSettle({
    elementText: label,
    tagName: el.tagName.toLowerCase(),
    pageTitle: document.title,
    pageUrl: window.location.href,
    clickX: null,
    clickY: null,
    stepType: 'type',
    typedValue: value
  }, () => {
    if (recordingOverlay) recordingOverlay.style.visibility = 'visible';
  });
}

function sendKeyStroke(el, keyLabel) {
  const elementText = describeElement(el);
  if (recordingOverlay) recordingOverlay.style.visibility = 'hidden';
  captureAfterSettle({
    elementText,
    tagName: el?.tagName?.toLowerCase() || 'body',
    pageTitle: document.title,
    pageUrl: window.location.href,
    clickX: null,
    clickY: null,
    stepType: 'keystroke',
    keyLabel
  }, () => {
    if (recordingOverlay) recordingOverlay.style.visibility = 'visible';
  });
}

// Capture click data
function captureClick(e) {
  if (!isRecording) return;
  if (recordingOverlay && recordingOverlay.contains(e.target)) return;

  const element = e.target;

  // Derive the label synchronously, before whatever the click triggers
  // (navigation, a re-render, a modal) has a chance to change this
  // element or remove it from the page entirely.
  const elementText = describeElement(element);

  const tagName = element.tagName.toLowerCase();
  const pageTitle = document.title;
  const pageUrl = window.location.href;

  // Normalize click coords to 0-1 so they map onto the screenshot regardless of resolution
  const clickX = e.clientX / window.innerWidth;
  const clickY = e.clientY / window.innerHeight;

  // Hide overlay so it doesn't appear in the screenshot
  if (recordingOverlay) recordingOverlay.style.visibility = 'hidden';

  // Wait for the click's effects to actually settle before capturing - see
  // waitForStableCapture's comment for why this isn't just a fixed delay.
  // If the click navigates to a new page, captureAfterSettle hands the
  // capture off to that page instead (see resumePendingCaptureIfAny).
  captureAfterSettle({
    elementText,
    tagName,
    pageTitle,
    pageUrl,
    clickX,
    clickY
  }, (response) => {
    if (recordingOverlay) recordingOverlay.style.visibility = 'visible';
    if (chrome.runtime.lastError) {
      console.log('Message sent, awaiting background response');
    } else {
      console.log('Step captured:', response?.stepId);
    }
  });
}

// A step whose capture was deferred by captureAfterSettle because its
// origin page navigated away mid-wait. Finish it here once this (new) page
// has actually loaded and settled, rather than guessing when that is.
function resumePendingCaptureIfAny(isRecordingNow) {
  chrome.storage.local.get('codexPendingCapture', (result) => {
    const pending = result.codexPendingCapture;
    if (!pending) return;
    chrome.storage.local.remove('codexPendingCapture');

    // Stale guard - don't resurrect a capture from an abandoned navigation
    // (recording stopped mid-flight, or the tab sat unloaded a long time)
    // onto a page it no longer has anything to do with.
    if (!isRecordingNow || Date.now() - pending.savedAt > 10000) return;

    const captureNow = () => waitForStableCapture(() => sendCaptureScreenshot(pending.stepData));
    if (document.readyState === 'complete') {
      captureNow();
    } else {
      window.addEventListener('load', captureNow, { once: true });
    }
  });
}

// Check recording status on content load
chrome.runtime.sendMessage({ action: 'getRecordingStatus' }, (response) => {
  const nowRecording = !!response?.isRecording;
  if (nowRecording) {
    isRecording = true;
    createRecordingOverlay();
    attachClickListener();
    attachKeyListeners();
  }
  resumePendingCaptureIfAny(nowRecording);
});
