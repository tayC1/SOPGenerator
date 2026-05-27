// Review page script for Scribe Clone

const stepsContainer = document.getElementById('stepsContainer');
const exportBtn = document.getElementById('exportBtn');
const backBtn = document.getElementById('backBtn');

let steps = [];
let draggedElement = null;
let draggedIndex = null;

// Load steps on page load
document.addEventListener('DOMContentLoaded', loadSteps);


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

function showExportForm(action) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;';

  var dialog = document.createElement('div');
  dialog.style.cssText = 'background:#fff;border-radius:12px;padding:28px 32px 24px;min-width:400px;max-width:520px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.22);font-family:Inter,sans-serif;';

  var heading = document.createElement('div');
  heading.style.cssText = 'font-size:15px;font-weight:700;color:rgba(30,30,30,1);margin-bottom:20px;letter-spacing:0.1px;';
  heading.textContent = 'Export SOP';

  function makeField(label, value, type) {
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-bottom:14px;';
    var lbl = document.createElement('label');
    lbl.style.cssText = 'display:block;font-size:11px;font-weight:700;color:rgba(100,100,100,1);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.6px;';
    lbl.textContent = label;
    var input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type || 'text';
    input.value = value || '';
    var baseStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid rgba(210,210,210,1);border-radius:6px;font-size:13px;font-family:Inter,sans-serif;color:rgba(30,30,30,1);outline:none;';
    input.style.cssText = baseStyle + (type === 'textarea' ? 'resize:vertical;' : 'resize:none;');
    if (type === 'textarea') input.rows = 2;
    input.addEventListener('focus', function () { input.style.borderColor = 'rgba(46,82,102,1)'; });
    input.addEventListener('blur', function () { input.style.borderColor = 'rgba(210,210,210,1)'; });
    wrapper.appendChild(lbl);
    wrapper.appendChild(input);
    return { wrapper: wrapper, input: input };
  }

  var today = new Date().toISOString().split('T')[0];

  chrome.storage.local.get(['sopTitle', 'sopSummary'], function (res) {
    var titleField    = makeField('Title',       (res.sopTitle   || steps[0]?.pageTitle || 'SOP Guide').trim());
    var categoryField = makeField('Category',    '');
    var authorField   = makeField('Author',      '');
    var dateField     = makeField('Date',        today, 'date');
    var descField     = makeField('Description', (res.sopSummary || '').trim(), 'textarea');

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:8px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:1.5px solid rgba(200,200,200,1);background:#fff;color:rgba(60,60,60,1);font-size:14px;font-weight:500;font-family:Inter,sans-serif;cursor:pointer;';
    cancelBtn.addEventListener('click', function () { document.body.removeChild(overlay); });

    var submitBtn = document.createElement('button');
    submitBtn.textContent = 'Export';
    submitBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:none;background:rgba(46,82,102,1);color:#fff;font-size:14px;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;';
    submitBtn.addEventListener('click', function () {
      document.body.removeChild(overlay);
      action({
        title:       titleField.input.value.trim()    || 'SOP Guide',
        category:    categoryField.input.value.trim(),
        author:      authorField.input.value.trim(),
        date:        dateField.input.value             || today,
        description: descField.input.value.trim()
      });
    });

    overlay.addEventListener('click', function (e) { if (e.target === overlay) document.body.removeChild(overlay); });
    dialog.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') submitBtn.click(); if (e.key === 'Escape') cancelBtn.click(); });

    dialog.appendChild(heading);
    dialog.appendChild(titleField.wrapper);
    dialog.appendChild(categoryField.wrapper);
    dialog.appendChild(authorField.wrapper);
    dialog.appendChild(dateField.wrapper);
    dialog.appendChild(descField.wrapper);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    titleField.input.focus();
    titleField.input.select();
  });
}

// Export button
exportBtn.addEventListener('click', () => {
  if (steps.length === 0) {
    alert('No steps to export');
    return;
  }
  showExportForm(generateMarkdown);
});

function generateMarkdown(meta) {
  var q = function(s) { return '"' + (s || '').replace(/"/g, '\\"') + '"'; };
  var today = new Date().toISOString().split('T')[0];
  let markdown = '';

  if (meta) {
    markdown += '---\n';
    markdown += 'title: ' + q(meta.title) + '\n';
    markdown += 'category: ' + (meta.category || '') + '\n';
    markdown += 'author: ' + (meta.author || '') + '\n';
    markdown += 'date: ' + (meta.date || today) + '\n';
    markdown += 'description: ' + q(meta.description) + '\n';
    markdown += '---\n\n';
  }

  markdown += `# ${meta ? meta.title : (steps[0]?.pageTitle || 'SOP')}\n\n`;
  markdown += `*Generated on ${new Date().toLocaleString()}*\n\n`;
  markdown += `**Total Steps:** ${steps.length}\n\n`;
  markdown += '---\n\n';

  steps.forEach((step, index) => {
    markdown += `## Step ${index + 1}: ${step.description || 'Untitled Step'}\n\n`;
    markdown += `![Step ${index + 1} Screenshot](data:image/png;base64,${step.screenshot})\n\n`;
    markdown += '---\n\n';
  });

  const safeTitle = (meta ? meta.title : 'SOP').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'SOP';
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeTitle}_${today}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  const payload = {
    title: meta ? meta.title : (steps[0]?.pageTitle || 'SOP'),
    url: steps[0]?.pageUrl || '',
    description: meta ? meta.description : '',
    author: '',
    steps: steps.map((step, i) => ({
      title: step.description || step.pageTitle || `Step ${i + 1}`,
      description: step.description || '',
      screenshot_base64: step.screenshot || ''
    }))
  };

  fetch(`${CONFIG.API_URL}/sops`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => console.log('SOP saved to backend, id:', data.id))
    .catch(err => console.error('Failed to save SOP to backend:', err));
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
