// Background Service Worker for CODEX

let isRecording = false;
let steps = [];

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    isRecording = true;
    steps = [];
    chrome.storage.local.set({ steps: [], isRecording: true });
    sendResponse({ status: 'recording started' });
  }

  if (request.action === 'stopRecording') {
    isRecording = false;
    chrome.storage.local.set({ isRecording: false });
    sendResponse({ status: 'recording stopped' });
  }

  if (request.action === 'captureScreenshot') {
    // Only background.js can call captureVisibleTab
    if (isRecording && sender.tab) {
      chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (screenshot) => {
        if (chrome.runtime.lastError) {
          console.error('Screenshot error:', chrome.runtime.lastError);
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          // Convert to base64
          const base64Screenshot = screenshot.replace('data:image/png;base64,', '');
          
          // Get existing steps
          chrome.storage.local.get('steps', (result) => {
            let stepsArray = result.steps || [];
            
            // Create step object with metadata from content script
            let description;
            if (request.stepType === 'keystroke') {
              description = `Press ${request.keyLabel}`;
            } else if (request.stepType === 'type') {
              description = `Type "${request.typedValue}" in ${request.elementText || request.tagName}`;
            } else {
              description = request.elementText || `Click on ${request.tagName}`;
            }

            const step = {
              id: Date.now(),
              screenshot: base64Screenshot,
              elementText: request.elementText || '',
              tagName: request.tagName || '',
              pageTitle: request.pageTitle || '',
              pageUrl: request.pageUrl || '',
              timestamp: new Date().toISOString(),
              description,
              stepType: request.stepType || 'click',
              typedValue: request.typedValue || null,
              keyLabel: request.keyLabel || null,
              clickX: request.clickX ?? null,
              clickY: request.clickY ?? null
            };
            
            stepsArray.push(step);
            chrome.storage.local.set({ steps: stepsArray });
            sendResponse({ status: 'screenshot captured', stepId: step.id });
          });
        }
      });
      
      // Return true to indicate we'll send response asynchronously
      return true;
    }
  }

  if (request.action === 'getSteps') {
    chrome.storage.local.get('steps', (result) => {
      sendResponse({ steps: result.steps || [] });
    });
    return true;
  }

  if (request.action === 'updateSteps') {
    chrome.storage.local.set({ steps: request.steps });
    sendResponse({ status: 'steps updated' });
  }

  if (request.action === 'clearRecording') {
    chrome.storage.local.set({ steps: [], isRecording: false });
    isRecording = false;
    sendResponse({ status: 'recording cleared' });
  }

  if (request.action === 'stopAndReview') {
    isRecording = false;
    chrome.storage.local.set({ isRecording: false });
    chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
    sendResponse({ status: 'stopped' });
  }

  if (request.action === 'getRecordingStatus') {
    chrome.storage.local.get('isRecording', (result) => {
      sendResponse({ isRecording: result.isRecording || false });
    });
    return true;
  }
});
