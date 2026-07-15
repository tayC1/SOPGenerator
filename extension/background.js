// Background Service Worker for CODEX

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log(`[auth-bridge] external message "${message.type}" from ${sender.origin}`);

  if (message.type === 'USER_SIGNED_IN') {
    if (!message.token || !message.user) {
      console.error('[auth-bridge] USER_SIGNED_IN message missing token or user:', message);
      sendResponse({ received: false, error: 'missing token or user' });
      return;
    }
    chrome.storage.local.set({ extensionToken: message.token, currentUser: message.user }, () => {
      if (chrome.runtime.lastError) {
        console.error('[auth-bridge] failed to store session:', chrome.runtime.lastError.message);
        sendResponse({ received: false, error: chrome.runtime.lastError.message });
        return;
      }
      console.log(`[auth-bridge] stored session for ${message.user.email}`);
      sendResponse({ received: true });
    });
    return true;
  }

  if (message.type === 'USER_SIGNED_OUT') {
    chrome.storage.local.remove(['currentUser', 'extensionToken'], () => {
      console.log('[auth-bridge] cleared stored session');
      sendResponse({ received: true });
    });
    return true;
  }

  if (message.type === 'EDIT_SOP') {
    if (!message.sop || message.sop.id == null) {
      console.error('[auth-bridge] EDIT_SOP message missing sop:', message);
      sendResponse({ received: false, error: 'missing sop' });
      return;
    }
    // Older saved SOPs stored the image under `screenshot_base64` instead of
    // `screenshot` - normalize so the editor (which only reads `.screenshot`) can render them.
    var normalizedSteps = (message.sop.steps || []).map(function (step) {
      if (!step.screenshot && step.screenshot_base64) {
        step = Object.assign({}, step, { screenshot: step.screenshot_base64 });
      }
      return step;
    });
    chrome.storage.local.set({
      steps: normalizedSteps,
      sopTitle: message.sop.title || '',
      sopSummary: message.sop.description || '',
      category: message.sop.category || '',
      editingSopId: message.sop.id,
      isRecording: false
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[auth-bridge] failed to store edit session:', chrome.runtime.lastError.message);
        sendResponse({ received: false, error: chrome.runtime.lastError.message });
        return;
      }
      chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
      sendResponse({ received: true });
    });
    return true;
  }
});

// chrome.storage.local is the single source of truth for recording state.
// The service worker is killed by Chrome after ~30s idle and any module-level
// variable is lost on restart, so nothing about an in-progress recording may
// live only in memory here - every read/write goes through storage.

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    chrome.storage.local.set({ steps: [], isRecording: true }, () => {
      sendResponse({ status: 'recording started' });
    });
    return true;
  }

  if (request.action === 'stopRecording') {
    chrome.storage.local.set({ isRecording: false }, () => {
      sendResponse({ status: 'recording stopped' });
    });
    return true;
  }

  if (request.action === 'captureScreenshot') {
    // Only background.js can call captureVisibleTab
    if (!sender.tab) {
      sendResponse({ error: 'no sender tab' });
      return true;
    }

    chrome.storage.local.get('isRecording', (statusResult) => {
      if (!statusResult.isRecording) {
        // Recording was stopped (or the worker restarted after the session
        // ended) - do not resurrect a step for a session that's not live.
        sendResponse({ error: 'not recording' });
        return;
      }

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
            chrome.storage.local.set({ steps: stepsArray }, () => {
              sendResponse({ status: 'screenshot captured', stepId: step.id });
            });
          });
        }
      });
    });

    // Return true to indicate we'll send response asynchronously
    return true;
  }

  if (request.action === 'getSteps') {
    chrome.storage.local.get('steps', (result) => {
      sendResponse({ steps: result.steps || [] });
    });
    return true;
  }

  if (request.action === 'updateSteps') {
    chrome.storage.local.set({ steps: request.steps }, () => {
      sendResponse({ status: 'steps updated' });
    });
    return true;
  }

  if (request.action === 'clearRecording') {
    chrome.storage.local.set({ steps: [], isRecording: false }, () => {
      sendResponse({ status: 'recording cleared' });
    });
    return true;
  }

  if (request.action === 'stopAndReview') {
    chrome.storage.local.set({ isRecording: false }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
      sendResponse({ status: 'stopped' });
    });
    return true;
  }

  if (request.action === 'getRecordingStatus') {
    chrome.storage.local.get('isRecording', (result) => {
      sendResponse({ isRecording: result.isRecording || false });
    });
    return true;
  }
});
