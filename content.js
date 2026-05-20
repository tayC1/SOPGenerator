// Content script for Scribe Clone

let isRecording = false;
let recordingOverlay = null;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    isRecording = true;
    createRecordingOverlay();
    attachClickListener();
    sendResponse({ status: 'recording started on page' });
  }

  if (request.action === 'stopRecording') {
    isRecording = false;
    removeRecordingOverlay();
    removeClickListener();
    sendResponse({ status: 'recording stopped on page' });
  }
});

// Create a small overlay toolbar to show recording is active
function createRecordingOverlay() {
  if (recordingOverlay) return;

  recordingOverlay = document.createElement('div');
  recordingOverlay.id = 'scribe-recording-overlay';
  recordingOverlay.innerHTML = `
    <div style="
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
      padding: 10px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      gap: 8px;
    ">
      <span style="
        display: inline-block;
        width: 8px;
        height: 8px;
        background: white;
        border-radius: 50%;
        animation: pulse 1s infinite;
      "></span>
      Recording...
    </div>
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    </style>
  `;
  
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

// Capture click data
function captureClick(e) {
  if (!isRecording) return;

  const element = e.target;
  
  // Get element text
  const elementText = element.innerText?.trim() || 
                      element.textContent?.trim() || 
                      element.value || 
                      element.placeholder || 
                      element.alt ||
                      element.title ||
                      '';

  const tagName = element.tagName.toLowerCase();
  const pageTitle = document.title;
  const pageUrl = window.location.href;

  // Send to background to capture screenshot
  chrome.runtime.sendMessage({
    action: 'captureScreenshot',
    elementText,
    tagName,
    pageTitle,
    pageUrl
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.log('Message sent, awaiting background response');
    } else {
      console.log('Step captured:', response?.stepId);
    }
  });
}

// Check recording status on content load
chrome.runtime.sendMessage({ action: 'getRecordingStatus' }, (response) => {
  if (response?.isRecording) {
    isRecording = true;
    createRecordingOverlay();
    attachClickListener();
  }
});
