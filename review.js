// Review page script for Scribe Clone

const stepsContainer = document.getElementById('stepsContainer');
const exportBtn = document.getElementById('exportBtn');
const backBtn = document.getElementById('backBtn');

let steps = [];
let draggedElement = null;
let draggedIndex = null;

// Load steps on page load
document.addEventListener('DOMContentLoaded', loadSteps);

// Build top bar: move existing header and back button into a flex top bar
document.addEventListener('DOMContentLoaded', function () {
  try {
    var root = document.querySelector('#scale-wrapper > div');
    if (!root) return;

    // find header div that contains the exact text 'Review Steps'
    var headerDiv = Array.from(root.querySelectorAll('div')).find(function (d) { return d.textContent && d.textContent.trim() === 'Review Steps'; });
    var back = document.getElementById('backBtn');
    if (!headerDiv || !back) return;

    // create topbar container (tall enough to hold headerInfo)
    var topbar = document.createElement('div');
    topbar.id = 'topbar';
    topbar.style.cssText = 'position:absolute;top:33px;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:0 40px;height:137px;pointer-events:auto;';

    // left: header
    var left = document.createElement('div');
    left.style.cssText = 'flex:0 1 auto;display:flex;align-items:center;gap:12px;';
    headerDiv.style.cssText = 'font-size:48px;color:rgba(255,255,255,1);margin:0;';
    left.appendChild(headerDiv);

    // center: prefer the existing `headerInfo` (steps/time/last-updated) created by scale.js
    var center = document.createElement('div');
    center.style.cssText = 'position:absolute;left:50%;top:0;bottom:0;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;';

    // find headerInfo created by scale.js (identified by its assigned ID)
    var headerInfoEl = document.getElementById('topbarHeaderInfo');
    if (headerInfoEl) {
      // move it into the center and ensure it centers its content
      headerInfoEl.style.cssText = 'display:flex;align-items:center;justify-content:center;pointer-events:none;height:100%;width:100%;gap:12px;';
      center.appendChild(headerInfoEl);
    } else {
      // fallback: show stored sopSummary
      var summary = document.createElement('div');
      summary.id = 'sopSummary';
      summary.style.cssText = 'display:inline-block;font-size:14px;color:rgba(255,255,255,0.95);max-width:720px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      chrome.storage && chrome.storage.local && chrome.storage.local.get(['sopSummary'], function (res) {
        summary.textContent = (res && res.sopSummary) ? res.sopSummary : '';
      });
      center.appendChild(summary);
    }

    // right: back button (move existing element)
    var right = document.createElement('div');
    right.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;';
    right.appendChild(back);

    topbar.appendChild(left);
    topbar.appendChild(center);
    topbar.appendChild(right);

    // insert topbar into root
    root.appendChild(topbar);
  } catch (e) {
    console.error('Topbar build error', e);
  }
});

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

// Export button
exportBtn.addEventListener('click', () => {
  if (steps.length === 0) {
    alert('No steps to export');
    return;
  }

  generateMarkdown();
});

function generateMarkdown() {
  let markdown = `# ${pageTitle}\n\n`;
  markdown += `*Generated on ${new Date().toLocaleString()}*\n\n`;
  markdown += `**Total Steps:** ${steps.length}\n\n`;
  markdown += '---\n\n';

  steps.forEach((step, index) => {
    markdown += `## Step ${index + 1}: ${step.description || 'Untitled Step'}\n\n`;
    
    // Add screenshot
    markdown += `![Step ${index + 1} Screenshot](data:image/png;base64,${step.screenshot})\n\n`;
    
    // Add metadata
    //markdown += '**Details:**\n\n';
    //markdown += `- **Page Title:** ${step.pageTitle || 'Unknown'}\n`;
    //markdown += `- **URL:** ${step.pageUrl || 'N/A'}\n`;
    //markdown += `- **Element Clicked:** \`<${step.tagName}>\` - ${step.elementText || 'No text'}\n`;
    //markdown += `- **Timestamp:** ${new Date(step.timestamp).toLocaleString()}\n\n`;
    
    markdown += '---\n\n';
  });

  // Create blob and download
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SOP_${new Date().toISOString().split('T')[0]}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  alert('SOP exported successfully!');
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
