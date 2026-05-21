// Content script for Scribe Clone

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
  const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
                el.getAttribute('name') || el.id || el.tagName.toLowerCase();
  if (recordingOverlay) recordingOverlay.style.visibility = 'hidden';
  setTimeout(() => {
    chrome.runtime.sendMessage({
      action: 'captureScreenshot',
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
  }, 60);
}

function sendKeyStroke(el, keyLabel) {
  const elementText = el?.innerText?.trim() || el?.value || el?.placeholder || el?.getAttribute?.('aria-label') || '';
  if (recordingOverlay) recordingOverlay.style.visibility = 'hidden';
  setTimeout(() => {
    chrome.runtime.sendMessage({
      action: 'captureScreenshot',
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
  }, 60);
}

// Capture click data
function captureClick(e) {
  if (!isRecording) return;
  if (recordingOverlay && recordingOverlay.contains(e.target)) return;

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

  // Normalize click coords to 0-1 so they map onto the screenshot regardless of resolution
  const clickX = e.clientX / window.innerWidth;
  const clickY = e.clientY / window.innerHeight;

  // Hide overlay so it doesn't appear in the screenshot
  if (recordingOverlay) recordingOverlay.style.visibility = 'hidden';

  // Wait one frame for the browser to repaint before capturing
  setTimeout(function () {
    chrome.runtime.sendMessage({
      action: 'captureScreenshot',
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
  }, 60);
}

// Check recording status on content load
chrome.runtime.sendMessage({ action: 'getRecordingStatus' }, (response) => {
  if (response?.isRecording) {
    isRecording = true;
    createRecordingOverlay();
    attachClickListener();
    attachKeyListeners();
  }
});
