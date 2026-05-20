// Popup script for Scribe Clone

const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const reviewBtn = document.getElementById('reviewBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const stepCount = document.getElementById('stepCount');

let isRecording = false;

// Initialize UI state
async function initializeUI() {
  chrome.storage.local.get(['isRecording', 'steps'], (result) => {
    isRecording = result.isRecording || false;
    const steps = result.steps || [];
    
    updateUI(isRecording, steps.length);
  });
}

// Update UI based on recording state
function updateUI(recording, stepNum) {
  isRecording = recording;
  
  if (recording) {
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    statusDot.classList.add('active');
    statusText.textContent = 'Recording...';
  } else {
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    statusDot.classList.remove('active');
    statusText.textContent = 'Ready to record';
  }
  
  reviewBtn.disabled = stepNum === 0;
  clearBtn.disabled = stepNum === 0;
  stepCount.textContent = `${stepNum} step${stepNum !== 1 ? 's' : ''} captured`;
}

// Record button
recordBtn.addEventListener('click', async () => {
  // Get all tabs and start recording on active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tabs.length > 0) {
    const activeTab = tabs[0];
    
    // Clear previous steps
    chrome.storage.local.set({ steps: [], isRecording: true });
    
    // Send message to background
    chrome.runtime.sendMessage({ action: 'startRecording' }, () => {
      // Inject content script to the active tab
      chrome.tabs.sendMessage(activeTab.id, { action: 'startRecording' }).catch(() => {
        // If content script not loaded, inject it
        chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['content.js']
        }, () => {
          chrome.tabs.sendMessage(activeTab.id, { action: 'startRecording' });
        });
      });
    });
    
    updateUI(true, 0);
  }
});

// Stop button
stopBtn.addEventListener('click', async () => {
  // Get all tabs
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tabs.length > 0) {
    const activeTab = tabs[0];
    
    // Send message to background
    chrome.runtime.sendMessage({ action: 'stopRecording' }, () => {
      // Send stop message to content script
      chrome.tabs.sendMessage(activeTab.id, { action: 'stopRecording' }).catch(() => {
        console.log('Content script not loaded');
      });
    });
    
    // Update UI
    chrome.storage.local.get('steps', (result) => {
      const steps = result.steps || [];
      updateUI(false, steps.length);
    });
  }
});

// Review button
reviewBtn.addEventListener('click', async () => {
  chrome.storage.local.get('steps', (result) => {
    const steps = result.steps || [];
    
    if (steps.length > 0) {
      // Open review page
      chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
    }
  });
});

// Clear button
clearBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to clear all captured steps?')) {
    chrome.storage.local.set({ steps: [], isRecording: false });
    isRecording = false;
    updateUI(false, 0);
    
    // Also stop recording on active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopRecording' }).catch(() => {});
      }
    });
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.steps) {
      const steps = changes.steps.newValue || [];
      chrome.storage.local.get('isRecording', (result) => {
        updateUI(result.isRecording || false, steps.length);
      });
    }
    if (changes.isRecording) {
      const recording = changes.isRecording.newValue || false;
      chrome.storage.local.get('steps', (result) => {
        updateUI(recording, (result.steps || []).length);
      });
    }
  }
});

// Initialize on popup open
initializeUI();
