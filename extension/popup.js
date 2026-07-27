// Popup script for SOP Generator

const recordBtn     = document.getElementById('recordBtn');
const stopReviewBtn = document.getElementById('stopReviewBtn');
const reviewBtn     = document.getElementById('reviewBtn');
const clearBtn      = document.getElementById('clearBtn');
const statusDot     = document.getElementById('statusDot');
const statusText    = document.getElementById('statusText');
const stepCount     = document.getElementById('stepCount');
const recStepCount  = document.getElementById('recStepCount');

let isRecording = false;

function updateUI(recording, count) {
  isRecording = recording;

  document.body.classList.toggle('is-recording', recording);

  recStepCount.textContent = count + (count === 1 ? ' step' : ' steps');

  stepCount.textContent = count;
  if (recording) {
    statusDot.classList.add('active');
    statusText.textContent = 'Recording';
  } else {
    statusDot.classList.remove('active');
    statusText.textContent = 'Ready';
  }

  reviewBtn.disabled = count === 0;
  clearBtn.disabled  = count === 0;
}

async function startRecording() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return;
  const activeTab = tabs[0];

  chrome.storage.local.set({ steps: [], isRecording: true, editingSopId: null });
  chrome.runtime.sendMessage({ action: 'startRecording' }, () => {
    chrome.tabs.sendMessage(activeTab.id, { action: 'startRecording' }).catch(() => {
      chrome.scripting.executeScript(
        { target: { tabId: activeTab.id }, files: ['content.js'] },
        () => chrome.tabs.sendMessage(activeTab.id, { action: 'startRecording' })
      );
    });
  });

  updateUI(true, 0);
}

async function stopAndReview() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length) {
    const activeTab = tabs[0];
    chrome.runtime.sendMessage({ action: 'stopRecording' }, () => {
      chrome.tabs.sendMessage(activeTab.id, { action: 'stopRecording' }).catch(() => {});
    });
  }

  chrome.storage.local.remove('editingSopId', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
  });
}

recordBtn.addEventListener('click', startRecording);

stopReviewBtn.addEventListener('click', stopAndReview);

reviewBtn.addEventListener('click', () => {
  chrome.storage.local.remove('editingSopId', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
  });
});

// window.confirm()/alert()/prompt() are silently ignored inside extension
// popups (Chrome disabled them - a popup can close while a native dialog
// would still be blocking), so confirmation has to be done inline instead.
let clearArmed = false;
let clearArmedTimeout = null;

clearBtn.addEventListener('click', () => {
  if (!clearArmed) {
    clearArmed = true;
    clearBtn.textContent = 'Confirm clear?';
    clearArmedTimeout = setTimeout(() => {
      clearArmed = false;
      clearBtn.textContent = 'Clear';
    }, 3000);
    return;
  }

  clearTimeout(clearArmedTimeout);
  clearArmed = false;
  clearBtn.textContent = 'Clear';

  chrome.storage.local.set({ steps: [], isRecording: false });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'stopRecording' }).catch(() => {});
    }
  });
  updateUI(false, 0);
});

document.getElementById('viewSopsBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://kpcodex-production.up.railway.app' });
});

adminLink.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://kpcodex-production.up.railway.app/admin' });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const stepsChange     = changes.steps;
  const recordingChange = changes.isRecording;

  const newCount     = stepsChange     ? (stepsChange.newValue     || []).length : null;
  const newRecording = recordingChange ? (recordingChange.newValue || false)      : null;

  chrome.storage.local.get(['steps', 'isRecording'], (result) => {
    updateUI(
      newRecording !== null ? newRecording : (result.isRecording || false),
      newCount     !== null ? newCount     : (result.steps || []).length
    );
  });

  if (changes.currentUser || changes.extensionToken) {
    renderAuthState();
  }
});

chrome.storage.local.get(['isRecording', 'steps'], (result) => {
  updateUI(result.isRecording || false, (result.steps || []).length);
});

// --- Signed-in state: who's signed in, and their SOPs for the active site ---

const userBar        = document.getElementById('userBar');
const userAvatar      = document.getElementById('userAvatar');
const userNameLabel  = document.getElementById('userNameLabel');
const signOutBtn     = document.getElementById('signOutBtn');
const signInLink     = document.getElementById('signInLink');
const adminLink      = document.getElementById('adminLink');
const siteSops       = document.getElementById('siteSops');
const siteSopsHeading = document.getElementById('siteSopsHeading');
const siteSopsList   = document.getElementById('siteSopsList');
const howItWorks     = document.getElementById('howItWorks');

function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function renderAuthState() {
  const { currentUser, extensionToken } = await chrome.storage.local.get(['currentUser', 'extensionToken']);

  if (!currentUser || !extensionToken) {
    userBar.style.display = 'none';
    siteSops.style.display = 'none';
    howItWorks.style.display = 'block';
    signInLink.style.display = 'inline';
    adminLink.style.display = 'none';
    return;
  }

  userBar.style.display = 'flex';
  siteSops.style.display = 'block';
  howItWorks.style.display = 'none';
  signInLink.style.display = 'none';
  adminLink.style.display = currentUser.is_admin ? 'inline' : 'none';

  userNameLabel.textContent = currentUser.name || currentUser.email || 'Signed in';
  userAvatar.textContent = initials(currentUser.name || currentUser.email);

  await loadSiteSops(extensionToken);
}

async function loadSiteSops(token) {
  siteSopsList.innerHTML = '<div class="site-sops-empty">Loading…</div>';

  let hostname = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    hostname = tabs[0]?.url ? new URL(tabs[0].url).hostname : null;
  } catch (err) {
    console.error('[popup] could not read active tab URL:', err);
  }

  siteSopsHeading.textContent = hostname ? `SOPs for ${hostname}` : 'Your SOPs';

  try {
    const res = await fetch(`${CONFIG.API_URL}/sops`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`request failed: ${res.status}`);
    const sops = await res.json();

    const matches = hostname
      ? sops.filter((s) => {
          try { return s.url && new URL(s.url).hostname === hostname; } catch { return false; }
        })
      : sops;

    if (matches.length === 0) {
      siteSopsList.innerHTML = `<div class="site-sops-empty">No SOPs yet for ${escapeHtml(hostname || 'this site')}.</div>`;
      return;
    }

    siteSopsList.innerHTML = matches
      .map((s) => `<button class="site-sop-item" data-sop-id="${s.id}" type="button">${escapeHtml(s.title)}</button>`)
      .join('');

    siteSopsList.querySelectorAll('[data-sop-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        chrome.tabs.create({ url: `${CONFIG.API_URL}/sop.html?id=${btn.dataset.sopId}` });
      });
    });
  } catch (err) {
    console.error('[popup] failed to load site SOPs:', err);
    siteSopsList.innerHTML = '<div class="site-sops-empty">Could not load SOPs right now.</div>';
  }
}

signOutBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['currentUser', 'extensionToken'], renderAuthState);
});

renderAuthState();
