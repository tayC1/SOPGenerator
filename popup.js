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

  // Toggle recording view vs idle view
  document.body.classList.toggle('is-recording', recording);

  // Recording dropdown counter
  recStepCount.textContent = count + (count === 1 ? ' step' : ' steps');

  // Idle view counter + status
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

  chrome.storage.local.set({ steps: [], isRecording: true });
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

  // Open review page — popup closes automatically when a new tab opens
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
}

// Record button (idle view)
recordBtn.addEventListener('click', startRecording);

// Stop & Review button (recording dropdown)
stopReviewBtn.addEventListener('click', stopAndReview);

// Review button (idle view, when steps already exist)
reviewBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
});

// Clear button
clearBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to clear all captured steps?')) {
    chrome.storage.local.set({ steps: [], isRecording: false });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopRecording' }).catch(() => {});
      }
    });
    updateUI(false, 0);
  }
});

// Keep step counter and user footer live
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const stepsChange     = changes.steps;
  const recordingChange = changes.isRecording;
  const userChange      = changes.currentUser;

  if (userChange) renderUser(userChange.newValue || null);

  const newCount     = stepsChange     ? (stepsChange.newValue     || []).length : null;
  const newRecording = recordingChange ? (recordingChange.newValue || false)      : null;

  chrome.storage.local.get(['steps', 'isRecording'], (result) => {
    updateUI(
      newRecording !== null ? newRecording : (result.isRecording || false),
      newCount     !== null ? newCount     : (result.steps || []).length
    );
  });
});

function renderUser(user) {
  const signedIn  = document.getElementById('user-signed-in');
  const signedOut = document.getElementById('user-signed-out');
  if (!signedIn || !signedOut) return;

  if (user) {
    signedOut.style.display = 'none';
    signedIn.style.display  = 'flex';

    document.getElementById('user-name').textContent  = user.name  || '';
    document.getElementById('user-email').textContent = user.email || '';

    const img      = document.getElementById('user-avatar-img');
    const initials = document.getElementById('user-avatar-initials');

    if (user.photo) {
      img.src             = user.photo;
      img.style.display   = 'block';
      initials.style.display = 'none';
    } else {
      const letter = (user.name || user.email || '?')[0].toUpperCase();
      initials.textContent   = letter;
      initials.style.display = 'flex';
      img.style.display      = 'none';
    }
  } else {
    signedIn.style.display  = 'none';
    signedOut.style.display = 'flex';
  }
}

async function loadUser() {
  try {
    const res = await fetch('https://kpcodex-production.up.railway.app/auth/me', {
      credentials: 'include',
    });
    const { user } = await res.json();
    chrome.storage.local.set({ currentUser: user || null });
    renderUser(user || null);
  } catch {
    renderUser(null);
  }
}

// Init
chrome.storage.local.get(['isRecording', 'steps'], (result) => {
  updateUI(result.isRecording || false, (result.steps || []).length);
});
loadUser();

document.getElementById('signin-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://kpcodex-production.up.railway.app/auth/google' });
});
