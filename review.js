// Review page script for Scribe Clone

const stepsContainer = document.getElementById('stepsContainer');
const backBtn = document.getElementById('backBtn');
const sopTitleInput = document.getElementById('sopTitle');
const sopDescriptionInput = document.getElementById('sopDescription');
const categorySelect = document.getElementById('categorySelect');
const uploadBtn = document.getElementById('uploadBtn');
const uploadStatus = document.getElementById('uploadStatus');

let steps = [];
let draggedElement = null;
let draggedIndex = null;

// Load steps on page load
document.addEventListener('DOMContentLoaded', loadSteps);
document.addEventListener('DOMContentLoaded', loadSopMeta);
document.addEventListener('DOMContentLoaded', loadCategoryOptions);


function loadSteps() {
  chrome.storage.local.get('steps', (result) => {
    steps = result.steps || [];
    
    if (steps.length === 0) {
      stepsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <p>No steps captured yet. Start a new recording!</p>
        </div>
      `;
    } else {
      renderSteps();
    }
  });
}

function renderSteps() {
  stepsContainer.innerHTML = '';
  
  steps.forEach((step, index) => {
    const stepCard = createStepCard(step, index);
    stepsContainer.appendChild(stepCard);
  });
}

function createStepCard(step, index) {
  const stepCard = document.createElement('div');
  stepCard.className = 'step-card';
  stepCard.draggable = true;
  stepCard.dataset.index = index;

  const pageTitle = step.pageTitle || 'Unknown Page';
  const pageUrl = step.pageUrl || '';
  const tagName = step.tagName || 'element';
  const elementText = step.elementText ? step.elementText.substring(0, 50) : 'No text';

  stepCard.innerHTML = `
    <div class="step-header">
      <div class="drag-handle">⋮⋮</div>
      <div class="step-number">${index + 1}</div>
      <div class="step-info">
        <div class="step-info-row">
          <div class="info-item">
            <span><strong>Page:</strong> ${pageTitle}</span>
          </div>
        </div>
        <div class="step-info-row">
          <div class="info-item">
            <span><strong>Clicked:</strong> ${tagName} ${elementText}</span>
          </div>
        </div>
      </div>
      <div class="step-controls">
        <button class="btn-small btn-delete" onclick="deleteStep(${index})">Delete</button>
      </div>
    </div>

    <div class="screenshot-container">
      <img src="data:image/png;base64,${step.screenshot}" alt="Step ${index + 1}" class="screenshot">
    </div>

    <div class="metadata">
      <div class="metadata-item">
        <div class="metadata-label">URL</div>
        <div class="metadata-value" title="${pageUrl}">${pageUrl ? pageUrl.substring(0, 50) + '...' : 'N/A'}</div>
      </div>
      <div class="metadata-item">
        <div class="metadata-label">Timestamp</div>
        <div class="metadata-value">${new Date(step.timestamp).toLocaleString()}</div>
      </div>
      <div class="metadata-item">
        <div class="metadata-label">Tag Name</div>
        <div class="metadata-value">&lt;${tagName}&gt;</div>
      </div>
      <div class="metadata-item">
        <div class="metadata-label">Element Text</div>
        <div class="metadata-value">${elementText}</div>
      </div>
    </div>

    <div class="step-description">
      <label for="desc-${index}">Step Description</label>
      <textarea id="desc-${index}" placeholder="Edit the step description here...">${step.description || ''}</textarea>
    </div>
  `;

  // Add drag event listeners
  stepCard.addEventListener('dragstart', (e) => {
    draggedElement = stepCard;
    draggedIndex = index;
    stepCard.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  stepCard.addEventListener('dragend', (e) => {
    draggedElement.classList.remove('dragging');
    draggedElement = null;
    draggedIndex = null;
  });

  stepCard.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (draggedElement && draggedElement !== stepCard) {
      const afterElement = getDragAfterElement(stepsContainer, e.clientY);
      if (afterElement == null) {
        stepsContainer.appendChild(draggedElement);
      } else {
        stepsContainer.insertBefore(draggedElement, afterElement);
      }
    }
  });

  stepCard.addEventListener('drop', (e) => {
    e.preventDefault();
    updateStepsOrder();
  });

  // Add description change listener
  const textarea = stepCard.querySelector(`textarea#desc-${index}`);
  textarea.addEventListener('change', (e) => {
    steps[index].description = e.target.value;
    saveSteps();
  });

  textarea.addEventListener('blur', (e) => {
    steps[index].description = e.target.value;
    saveSteps();
  });

  return stepCard;
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.step-card:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateStepsOrder() {
  const stepCards = document.querySelectorAll('.step-card');
  const newSteps = [];
  
  stepCards.forEach((card, index) => {
    const oldIndex = parseInt(card.dataset.index);
    newSteps.push(steps[oldIndex]);
  });
  
  steps = newSteps;
  saveSteps();
  renderSteps();
}

function deleteStep(index) {
  if (confirm('Delete this step?')) {
    steps.splice(index, 1);
    saveSteps();
    renderSteps();
  }
}

function saveSteps() {
  chrome.storage.local.set({ steps: steps });
}


// Back button
backBtn.addEventListener('click', () => {
  window.close();
});

// Listen for storage changes to reload if changed in popup
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.steps) {
    steps = changes.steps.newValue || [];
    renderSteps();
  }
});

// --- SOP title/description, persisted so a tab close doesn't lose them ---

function loadSopMeta() {
  chrome.storage.local.get(['sopTitle', 'sopDescription'], (result) => {
    sopTitleInput.value = result.sopTitle || '';
    sopDescriptionInput.value = result.sopDescription || '';
  });
}

sopTitleInput.addEventListener('change', () => {
  chrome.storage.local.set({ sopTitle: sopTitleInput.value });
});

sopDescriptionInput.addEventListener('change', () => {
  chrome.storage.local.set({ sopDescription: sopDescriptionInput.value });
});

// --- Category dropdown, sourced from the departments table ---

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadCategoryOptions() {
  chrome.storage.local.get('category', ({ category: storedCategory }) => {
    fetch(`${CONFIG.API_URL}/departments`)
      .then((res) => {
        if (!res.ok) throw new Error(`request failed: ${res.status}`);
        return res.json();
      })
      .then((departments) => {
        categorySelect.innerHTML = '<option value="">Uncategorized</option>' +
          departments.map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
        if (storedCategory && departments.some((d) => d.name === storedCategory)) {
          categorySelect.value = storedCategory;
        }
      })
      .catch((err) => console.error('[review] failed to load departments:', err));
  });
}

// --- Upload to Knowledge Base ---

function setUploadStatus(message, type) {
  uploadStatus.textContent = message;
  uploadStatus.className = `upload-status${type ? ' ' + type : ''}`;
}

async function uploadToKnowledgeBase() {
  const title = sopTitleInput.value.trim();
  if (!title) {
    setUploadStatus('Please add a title before uploading.', 'error');
    sopTitleInput.focus();
    return;
  }

  if (steps.length === 0) {
    setUploadStatus('There are no steps to upload.', 'error');
    return;
  }

  const { extensionToken } = await chrome.storage.local.get('extensionToken');
  if (!extensionToken) {
    setUploadStatus('Please sign in on the CODEX website before uploading.', 'error');
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading…';
  setUploadStatus('');

  try {
    const res = await fetch(`${CONFIG.API_URL}/sops`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${extensionToken}`,
      },
      body: JSON.stringify({
        title,
        description: sopDescriptionInput.value.trim(),
        category: categorySelect.value || null,
        url: steps[0]?.pageUrl || null,
        steps,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `request failed: ${res.status}`);
    }

    setUploadStatus('Uploaded to the knowledge base.', 'success');
    chrome.storage.local.set({ steps: [], isRecording: false, sopTitle: '', sopDescription: '' });
    loadSteps();
    sopTitleInput.value = '';
    sopDescriptionInput.value = '';
  } catch (err) {
    console.error('[review] upload failed:', err);
    setUploadStatus(`Upload failed: ${err.message}`, 'error');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload to Knowledge Base';
  }
}

uploadBtn.addEventListener('click', uploadToKnowledgeBase);
