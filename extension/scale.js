document.addEventListener('DOMContentLoaded', function () {
  var steps = [];
  var stepsContainer;
  var _skipStorageEvent = false;
  var sopIntroEl = null;
  var editingSopId = null;
  var headerDivRef = null;
  var exportLabelRef = null;

  // ── GitHub Config ──────────────────────────────────────────────────
  var GITHUB_TOKEN = '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';          // Personal Access Token (ghp_...)
  var GITHUB_REPO  = 'tayC1/KPCodex';          // e.g. 'taylorchristesson/codex-sops'
  var GITHUB_DIR   = 'sops';      // directory inside the repo (no leading slash)
  // ──────────────────────────────────────────────────────────────────

  function showConfirm(message, onConfirm) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;';

    var dialog = document.createElement('div');
    dialog.style.cssText = 'background:#fff;border-radius:12px;padding:28px 32px 24px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.22);font-family:Inter,sans-serif;';

    var heading = document.createElement('div');
    heading.style.cssText = 'font-size:15px;font-weight:700;color:rgba(30,30,30,1);margin-bottom:10px;letter-spacing:0.1px;';
    heading.textContent = 'SOP Generator';

    var msg = document.createElement('div');
    msg.style.cssText = 'font-size:14px;color:rgba(80,80,80,1);margin-bottom:24px;line-height:1.5;';
    msg.textContent = message;

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:1.5px solid rgba(200,200,200,1);background:#fff;color:rgba(60,60,60,1);font-size:14px;font-weight:500;font-family:Inter,sans-serif;cursor:pointer;';
    cancelBtn.addEventListener('click', function () { document.body.removeChild(overlay); });

    var confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirm';
    confirmBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:none;background:rgba(200,107,102,1);color:#fff;font-size:14px;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;';
    confirmBtn.addEventListener('click', function () { document.body.removeChild(overlay); onConfirm(); });

    overlay.addEventListener('click', function (e) { if (e.target === overlay) document.body.removeChild(overlay); });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(heading);
    dialog.appendChild(msg);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    confirmBtn.focus();
  }

  function scaleToFit() {
    var el = document.getElementById('scale-wrapper');
    if (!el) return;
    var scale = window.innerWidth / 1440;
    var scaledHeight = Math.ceil(window.innerHeight / scale);
    el.style.transform = 'scale(' + scale + ')';
    el.style.height = scaledHeight + 'px';
    document.body.style.height = window.innerHeight + 'px';
    if (stepsContainer) {
      stepsContainer.style.height = (scaledHeight - 137) + 'px';
    }
  }
  scaleToFit();
  window.addEventListener('resize', scaleToFit);

  var backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', function () { window.close(); });
  }

  var exportBtn = document.getElementById('exportBtn');
  function buildMarkdown(sopTitle, sopSummary, meta) {
    var md = '';
    if (meta) {
      var q = function(s) { return '"' + (s || '').replace(/"/g, '\\"') + '"'; };
      md += '---\n';
      md += 'title: ' + q(meta.title || sopTitle) + '\n';
      md += 'category: ' + (meta.category || '') + '\n';
      md += 'author: ' + (meta.author || '') + '\n';
      md += 'date: ' + (meta.date || new Date().toISOString().split('T')[0]) + '\n';
      md += 'description: ' + q(meta.description || sopSummary) + '\n';
      md += '---\n\n';
    }
    md += '# ' + sopTitle + '\n\n';
    if (sopSummary) md += sopSummary + '\n\n';
    var stepNum = 0;
    steps.forEach(function (step) {
      if (step.type === 'warning') {
        md += '> **Warning:** ' + (step.content || '') + '\n\n';
      } else if (step.type === 'tip') {
        md += '> **Tip:** ' + (step.content || '') + '\n\n';
      } else if (step.type === 'flag') {
        md += '> **Note:** ' + (step.content || '') + '\n\n';
      } else {
        stepNum++;
        md += '## Step ' + stepNum + ': ' + (step.content || step.description || 'Untitled Step') + '\n\n';
        if (step.screenshot) {
          md += '![Step ' + stepNum + '](data:image/png;base64,' + step.screenshot + ')\n\n';
        }
      }
    });
    return md;
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

    function makeSelectField(label, options, selectedValue) {
      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'margin-bottom:14px;';
      var lbl = document.createElement('label');
      lbl.style.cssText = 'display:block;font-size:11px;font-weight:700;color:rgba(100,100,100,1);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.6px;';
      lbl.textContent = label;
      var select = document.createElement('select');
      select.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid rgba(210,210,210,1);border-radius:6px;font-size:13px;font-family:Inter,sans-serif;color:rgba(30,30,30,1);outline:none;background:#fff;cursor:pointer;';
      var uncatOpt = document.createElement('option');
      uncatOpt.value = '';
      uncatOpt.textContent = 'Uncategorized';
      select.appendChild(uncatOpt);
      options.forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      });
      if (selectedValue && options.indexOf(selectedValue) !== -1) select.value = selectedValue;
      select.addEventListener('focus', function () { select.style.borderColor = 'rgba(46,82,102,1)'; });
      select.addEventListener('blur', function () { select.style.borderColor = 'rgba(210,210,210,1)'; });
      wrapper.appendChild(lbl);
      wrapper.appendChild(select);
      return { wrapper: wrapper, input: select };
    }

    var today = new Date().toISOString().split('T')[0];

    var metaPromise = new Promise(function (resolve) {
      chrome.storage.local.get(['sopTitle', 'sopSummary', 'category'], resolve);
    });
    var departmentsPromise = fetch(CONFIG.API_URL + '/departments')
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function (err) { console.error('[review] failed to load departments:', err); return []; });

    Promise.all([metaPromise, departmentsPromise]).then(function (results) {
      var res = results[0];
      var departmentNames = results[1].map(function (d) { return d.name; });

      var titleField    = makeField('Title',       (res.sopTitle   || 'SOP Guide').trim());
      var categoryField = makeSelectField('Category', departmentNames, res.category);
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
        var categoryValue = categoryField.input.value.trim();
        chrome.storage.local.set({ category: categoryValue });
        action({
          title:       titleField.input.value.trim()    || 'SOP Guide',
          category:    categoryValue,
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

  function doExport() {
    if (steps.length === 0) { alert('No steps to export.'); return; }
    showExportForm(function (meta) {
      var md = buildMarkdown(meta.title, meta.description, meta);
      var safeTitle = meta.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'SOP';
      var blob = new Blob([md], { type: 'text/markdown' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = safeTitle + '.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  function showToast(message, isError) {
    var toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'position:fixed', 'bottom:28px', 'right:28px',
      'background:' + (isError ? 'rgba(200,60,60,1)' : 'rgba(46,82,102,1)'),
      'color:#fff', 'padding:12px 20px', 'border-radius:8px',
      'font-family:Inter,sans-serif', 'font-size:14px', 'font-weight:600',
      'z-index:99999', 'box-shadow:0 4px 18px rgba(0,0,0,0.22)',
      'pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3000);
  }

  // Draws the marker dot directly into the screenshot's pixels so it survives
  // anywhere downstream that only renders the raw image (server, sop.html, exports).
  function bakeMarker(base64, clickX, clickY) {
    return new Promise(function (resolve) {
      if (!base64 || clickX == null || clickY == null) { resolve(base64); return; }
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var r = 16;
        ctx.beginPath();
        ctx.arc(clickX * canvas.width, clickY * canvas.height, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(224,75,42,0.25)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#e04b2a';
        ctx.stroke();
        resolve(canvas.toDataURL('image/png').replace('data:image/png;base64,', ''));
      };
      img.onerror = function () { resolve(base64); };
      img.src = 'data:image/png;base64,' + base64;
    });
  }

  function pushToCodex() {
    if (steps.length === 0) { showToast('No steps to push.', true); return; }
    chrome.storage.local.get('extensionToken', function (result) {
      var extensionToken = result.extensionToken;
      if (!extensionToken) { showSignInPrompt(); return; }
      showExportForm(function (meta) {
        showToast('Saving to CODEX…');
        Promise.all(steps.map(function (step) {
          return bakeMarker(step.screenshot, step.clickX, step.clickY);
        })).then(function (bakedScreenshots) {
          var bakedSteps = steps.map(function (step, i) {
            var copy = Object.assign({}, step);
            copy.screenshot = bakedScreenshots[i] || step.screenshot;
            return copy;
          });
          var payload = {
            title: meta.title,
            description: meta.description || '',
            category: meta.category || null,
            url: (steps[0] && steps[0].pageUrl) || '',
            steps: bakedSteps
          };
          fetch(CONFIG.API_URL + '/sops', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + extensionToken
            },
            body: JSON.stringify(payload)
          })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
            .then(function (result) {
              if (result.ok) {
                showCodexSuccess();
                chrome.storage.local.set({ steps: [], isRecording: false });
                chrome.storage.local.remove(['sopTitle', 'sopSummary', 'category']);
                steps = [];
                sopIntroEl = null;
                updateHeaderInfo();
                renderSteps();
              } else {
                showToast((result.data && result.data.error) || 'Failed to save — check your connection', true);
              }
            })
            .catch(function () {
              showToast('Failed to save — check your connection', true);
            });
        });
      });
    });
  }

  function saveEditedSop() {
    if (!editingSopId) return;
    if (steps.length === 0) { showToast('No steps to save.', true); return; }
    chrome.storage.local.get(['extensionToken', 'sopTitle', 'sopSummary', 'category'], function (result) {
      var extensionToken = result.extensionToken;
      if (!extensionToken) { showSignInPrompt(); return; }
      showToast('Saving…');
      var payload = {
        title: (result.sopTitle || 'SOP Guide').trim(),
        description: (result.sopSummary || '').trim(),
        category: result.category || null,
        url: (steps[0] && steps[0].pageUrl) || '',
        steps: steps
      };
      fetch(CONFIG.API_URL + '/sops/' + editingSopId, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + extensionToken
        },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result2) {
          if (result2.ok) {
            showToast('Saved ✓');
          } else {
            showToast((result2.data && result2.data.error) || 'Failed to save — check your connection', true);
          }
        })
        .catch(function () {
          showToast('Failed to save — check your connection', true);
        });
    });
  }

  function showSignInPrompt() {
    var el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'bottom:28px', 'right:28px',
      'background:rgba(46,82,102,1)', 'color:#fff',
      'padding:14px 20px', 'border-radius:10px',
      'font-family:Inter,sans-serif', 'font-size:14px', 'font-weight:600',
      'z-index:99999', 'box-shadow:0 4px 18px rgba(0,0,0,0.22)',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'min-width:220px'
    ].join(';');
    var msg = document.createElement('div');
    msg.textContent = 'You need to be signed in to save to CODEX.';
    msg.style.cssText = 'font-size:13px;font-weight:500;line-height:1.4;';
    var link = document.createElement('div');
    link.textContent = 'Sign in →';
    link.style.cssText = 'font-size:13px;font-weight:600;cursor:pointer;text-decoration:underline;opacity:0.9;';
    link.addEventListener('click', function () {
      chrome.tabs.create({ url: 'https://kpcodex-production.up.railway.app' });
      if (el.parentNode) el.remove();
    });
    el.appendChild(msg);
    el.appendChild(link);
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 8000);
  }

  function showCodexSuccess() {
    var el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'bottom:28px', 'right:28px',
      'background:rgba(46,82,102,1)', 'color:#fff',
      'padding:14px 20px', 'border-radius:10px',
      'font-family:Inter,sans-serif', 'font-size:14px', 'font-weight:600',
      'z-index:99999', 'box-shadow:0 4px 18px rgba(0,0,0,0.22)',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'min-width:200px'
    ].join(';');

    var msg = document.createElement('div');
    msg.textContent = 'Saved to CODEX ✓';

    var link = document.createElement('div');
    link.textContent = 'View in CODEX →';
    link.style.cssText = 'font-size:13px;font-weight:500;opacity:0.85;cursor:pointer;text-decoration:underline;';
    link.addEventListener('click', function () {
      chrome.tabs.create({ url: 'https://kpcodex-production.up.railway.app/dashboard' });
      if (el.parentNode) el.remove();
    });

    el.appendChild(msg);
    el.appendChild(link);
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 8000);
  }

  var wrapper = document.getElementById('scale-wrapper');
  if (wrapper) {
    stepsContainer = document.createElement('div');
    var initialScale = window.innerWidth / 1440;
    var initialHeight = Math.ceil(window.innerHeight / initialScale) - 137;
    stepsContainer.style.cssText = [
      'position: absolute',
      'top: 137px',
      'left: 0',
      'width: 1440px',
      'height: ' + initialHeight + 'px',
      'overflow-y: auto',
      'overflow-x: hidden',
      'padding: 24px 191px',
      'box-sizing: border-box',
      'background-color: rgba(221, 228, 233, 1.00)'
    ].join('; ');
    wrapper.appendChild(stepsContainer);
  }

  var headerInfo;
  if (wrapper) {
    headerInfo = document.createElement('div');
    headerInfo.id = 'topbarHeaderInfo';
    headerInfo.style.cssText = 'display:flex;flex-direction:column;justify-content:center;gap:10px;pointer-events:none;height:100%;';
    wrapper.appendChild(headerInfo);
  }

  // Build top bar: move "Review Steps" header and back button into a flex bar,
  // with headerInfo absolutely centered between them.
  (function buildTopbar() {
    try {
      var root = document.querySelector('#scale-wrapper > div');
      if (!root) return;
      var headerDiv = Array.from(root.querySelectorAll('div')).find(function (d) {
        return d.textContent && d.textContent.trim() === 'Review Steps';
      });
      var backImg = document.getElementById('backBtn');
      if (!headerDiv || !backImg) return;
      headerDivRef = headerDiv;

      // The "Back" label is a pointer-events:none div overlaid on the backBtn image
      var backLabel = Array.from(root.querySelectorAll('div')).find(function (d) {
        return d.textContent.trim() === 'Back' && d.style.pointerEvents === 'none';
      });

      var topbar = document.createElement('div');
      topbar.id = 'topbar';
      topbar.style.cssText = 'position:relative;z-index:10;height:137px;width:1440px;pointer-events:auto;overflow:visible;';

      // Find and move the logo div (position: absolute; top: 22px; left: 19px) into the topbar
      var logoDiv = Array.from(root.querySelectorAll('div')).find(function (d) {
        return d.style && d.style.top === '22px' && d.style.left === '19px';
      });

      // left: start at 19px (logo position) and use flex row to hold logo + title
      var leftSection = document.createElement('div');
      leftSection.style.cssText = 'position:absolute;left:19px;top:0;bottom:0;display:flex;align-items:center;gap:11px;overflow:visible;';

      if (logoDiv) {
        logoDiv.style.cssText = 'width:96px;height:102px;flex-shrink:0;position:relative;overflow:visible;';
        leftSection.appendChild(logoDiv);
      }

      headerDiv.style.cssText = 'font-size:48px;color:rgba(255,255,255,1);margin:0;position:static;';
      leftSection.appendChild(headerDiv);

      var centerSection = document.createElement('div');
      centerSection.style.cssText = 'position:absolute;left:50%;top:0;bottom:0;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;pointer-events:none;';
      if (headerInfo) centerSection.appendChild(headerInfo);

      // right: wrap back + export buttons so they stay aligned
      var rightSection = document.createElement('div');
      rightSection.style.cssText = 'position:absolute;right:40px;top:0;bottom:0;display:flex;align-items:center;gap:16px;';

      // Move export button into topbar
      var exportImg = document.getElementById('exportBtn');
      var exportLabel = Array.from(root.querySelectorAll('div')).find(function (d) {
        return d.textContent.trim() === 'Export as MD' && d.style.pointerEvents === 'none';
      });
      if (exportImg) {
        var exportWrapper = document.createElement('div');
        exportWrapper.style.cssText = 'position:relative;width:160px;height:45px;cursor:pointer;';
        exportImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        exportWrapper.appendChild(exportImg);
        if (exportLabel) {
          exportLabel.textContent = 'Export ▾';
          exportLabel.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:18px;color:rgba(255,255,255,1);font-family:Inter;font-weight:600;pointer-events:none;letter-spacing:0.1px;';
          exportWrapper.appendChild(exportLabel);
          exportLabelRef = exportLabel;
        }

        var exportDropdown = document.createElement('div');
        exportDropdown.style.cssText = 'position:absolute;top:calc(100% + 8px);right:0;background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,0.2);overflow:hidden;min-width:210px;display:none;z-index:9999;';

        function makeExportOption(text, onClick) {
          var opt = document.createElement('div');
          opt.innerHTML = text;
          opt.style.cssText = 'padding:13px 18px;font-size:14px;font-weight:600;font-family:Inter,sans-serif;color:rgba(30,30,30,1);cursor:pointer;transition:background 0.1s;white-space:nowrap;';
          opt.addEventListener('mouseenter', function () { opt.style.background = 'rgba(46,82,102,0.07)'; });
          opt.addEventListener('mouseleave', function () { opt.style.background = ''; });
          opt.addEventListener('click', function (e) {
            e.stopPropagation();
            exportDropdown.style.display = 'none';
            onClick();
          });
          return opt;
        }

        exportDropdown.appendChild(makeExportOption('&#8593;&nbsp; Push to Codex', pushToCodex));
        exportDropdown.appendChild(makeExportOption('&#8595;&nbsp; Download as .MD', doExport));
        exportWrapper.appendChild(exportDropdown);

        exportWrapper.addEventListener('click', function (e) {
          e.stopPropagation();
          if (steps.length === 0) { alert('No steps to export.'); return; }
          if (editingSopId) { saveEditedSop(); return; }
          exportDropdown.style.display = exportDropdown.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', function () { exportDropdown.style.display = 'none'; });

        rightSection.appendChild(exportWrapper);
      }

      var backWrapper = document.createElement('div');
      backWrapper.style.cssText = 'position:relative;width:110px;height:45px;cursor:pointer;';
      backImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      backWrapper.appendChild(backImg);
      if (backLabel) {
        backLabel.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;color:rgba(255,255,255,1);font-family:Inter;font-weight:400;pointer-events:none;';
        backWrapper.appendChild(backLabel);
      }
      rightSection.insertBefore(backWrapper, rightSection.firstChild);

      topbar.appendChild(leftSection);
      topbar.appendChild(centerSection);
      topbar.appendChild(rightSection);
      root.insertBefore(topbar, root.firstChild);
    } catch (e) {
      console.error('Topbar build error', e);
    }
  })();

  chrome.storage.local.get('editingSopId', function (result) {
    editingSopId = result.editingSopId || null;
    if (!editingSopId) return;
    if (headerDivRef) headerDivRef.textContent = 'Edit Steps';
    if (exportLabelRef) exportLabelRef.textContent = 'Save';
  });

  function updateHeaderInfo() {
    if (!headerInfo) return;
    var capturedStep = steps.find(function (s) { return s.pageUrl; });
    if (!capturedStep) { headerInfo.innerHTML = ''; return; }

    var firstUrl = capturedStep.pageUrl || '';
    var appName = 'Unknown';
    try {
      var host = new URL(firstUrl).hostname;
      var parts = host.split('.');
      appName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
      appName = appName.charAt(0).toUpperCase() + appName.slice(1);
    } catch (e) {
      appName = capturedStep.pageTitle || 'Unknown';
    }

    var timeAgo = '';
    var firstStep = steps[0];
    if (firstStep && firstStep.timestamp) {
      var stepDate = new Date(firstStep.timestamp);
      var now = new Date();
      var yest = new Date(now); yest.setDate(now.getDate() - 1);
      if (stepDate.toDateString() === now.toDateString()) {
        timeAgo = 'Today';
      } else if (stepDate.toDateString() === yest.toDateString()) {
        timeAgo = 'Yesterday';
      } else {
        timeAgo = stepDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: stepDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
      }
    }

    var procedureCount = steps.filter(function (s) { return !s.type || s.type === 'text'; }).length;
    var readMins = Math.max(1, Math.round(procedureCount * 15 / 60));
    var readTime = readMins + ' min' + (readMins !== 1 ? 's' : '');

    var pillPalette = ['#F59E0B', '#10B981', '#6366F1', '#EC4899', '#14B8A6', '#EF4444', '#8B5CF6'];
    var pillColor = pillPalette[appName.charCodeAt(0) % pillPalette.length];

    var faviconHost = '';
    try {
      var fParts = new URL(firstUrl).hostname.split('.');
      faviconHost = fParts.length >= 2 ? fParts.slice(-2).join('.') : fParts[0];
    } catch (e) {}
    var faviconUrl = faviconHost ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(faviconHost) + '&sz=32' : '';

    function stat(text) {
      return '<span style="font-family:Inter,sans-serif;font-size:14px;font-weight:500;color:rgba(255,255,255,0.92);letter-spacing:0.1px;">' + text + '</span>';
    }
    function dot() {
      return '<span style="color:rgba(255,255,255,0.25);font-size:11px;margin:0 2px;">●</span>';
    }

    headerInfo.innerHTML = [
      '<div style="display:flex;align-items:center;gap:8px;">',
        stat(procedureCount + (procedureCount !== 1 ? ' steps' : ' step')),
        dot(),
        stat(readTime),
        dot(),
        '<span style="font-family:Inter,sans-serif;font-size:13px;color:rgba(255,255,255,0.5);">&#128336; ' + timeAgo + '</span>',
      '</div>',
      '<div style="display:inline-flex;align-items:center;gap:8px;width:fit-content;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:999px;padding:5px 14px 5px 8px;pointer-events:all;">',
        faviconUrl
          ? '<img src="' + faviconUrl + '" width="20" height="20" style="border-radius:50%;flex-shrink:0;object-fit:contain;" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'block\';" /><div style="display:none;width:20px;height:20px;border-radius:50%;background:' + pillColor + ';flex-shrink:0;"></div>'
          : '<div style="width:20px;height:20px;border-radius:50%;background:' + pillColor + ';flex-shrink:0;"></div>',
        '<a href="' + firstUrl + '" target="_blank" style="font-family:Inter,sans-serif;font-size:13px;font-weight:600;color:rgba(255,255,255,0.95);letter-spacing:0.2px;text-decoration:none;pointer-events:all;">' + appName + '</a>',
      '</div>'
    ].join('');
  }

  function stepNumber(upToIndex) {
    var count = 0;
    for (var i = 0; i <= upToIndex; i++) {
      var t = steps[i].type;
      if (t !== 'warning' && t !== 'tip' && t !== 'flag') count++;
    }
    return count;
  }

  function addManualStep(insertIndex, type) {
    var newStep = {
      id: Date.now(),
      type: type,
      content: '',
      timestamp: new Date().toISOString()
    };
    steps.splice(insertIndex, 0, newStep);
    updateHeaderInfo();
    renderSteps();
    var card = stepsContainer.querySelector('[data-step-index="' + insertIndex + '"]');
    if (card) {
      var ta = card.querySelector('textarea');
      if (ta) ta.focus();
    }
    _skipStorageEvent = true;
    chrome.storage.local.set({ steps: steps }, function () {
      _skipStorageEvent = false;
    });
  }

  function createInsertRow(insertIndex) {
    var row = document.createElement('div');
    row.style.cssText = 'position:relative;height:24px;display:flex;align-items:center;justify-content:center;';

    var line = document.createElement('div');
    line.style.cssText = 'position:absolute;left:0;right:0;height:1px;background:rgba(46,82,102,0.3);opacity:0;transition:opacity 0.15s;pointer-events:none;';
    row.appendChild(line);

    var btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;align-items:center;gap:6px;opacity:0;transition:opacity 0.15s;position:relative;z-index:1;';

    var typeOptions = [
      { key: 'text',    label: '+ Step',       bg: 'rgba(46,82,102,1)'   },
      { key: 'warning', label: '⚠ Warning', bg: 'rgba(245,158,11,1)' },
      { key: 'tip',     label: '💡 Tip',   bg: 'rgba(16,185,129,1)' },
      { key: 'flag',    label: '🚩 Flag',  bg: 'rgba(99,102,241,1)' }
    ];

    typeOptions.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.textContent = opt.label;
      btn.style.cssText = 'background:' + opt.bg + ';color:#fff;border:none;border-radius:99px;padding:3px 13px;font-size:11px;font-weight:700;font-family:Inter,sans-serif;cursor:pointer;white-space:nowrap;letter-spacing:0.2px;';
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
      });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        addManualStep(insertIndex, opt.key);
      });
      btnGroup.appendChild(btn);
    });

    row.appendChild(btnGroup);

    row.addEventListener('mouseenter', function () {
      line.style.opacity = '1';
      btnGroup.style.opacity = '1';
    });
    row.addEventListener('mouseleave', function () {
      line.style.opacity = '0';
      btnGroup.style.opacity = '0';
    });

    return row;
  }

  function renderSteps() {
    if (!stepsContainer) return;
    stepsContainer.innerHTML = '';

    if (sopIntroEl) stepsContainer.appendChild(sopIntroEl);

    if (steps.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:80px 0 24px;font-family:Inter,sans-serif;font-size:24px;color:rgba(70,70,70,1);';
      empty.textContent = 'No steps captured yet. Start a new recording!';
      stepsContainer.appendChild(empty);
      stepsContainer.appendChild(createInsertRow(0));
      return;
    }

    stepsContainer.appendChild(createInsertRow(0));
    steps.forEach(function (step, index) {
      stepsContainer.appendChild(createStepCard(step, index));
      stepsContainer.appendChild(createInsertRow(index + 1));
    });
  }

  function createStepCard(step, index) {
    var type = step.type;
    var isAnnot = type === 'warning' || type === 'tip' || type === 'flag';
    var num = isAnnot ? null : stepNumber(index);

    var cardBg, accentBg, badgeHTML, labelColor;
    if (type === 'warning') {
      cardBg = 'rgba(255,251,235,1)';
      accentBg = 'rgba(245,158,11,1)';
      badgeHTML = '<span style="font-size:26px;line-height:1;">⚠️</span>';
      labelColor = 'rgba(161,98,7,1)';
    } else if (type === 'tip') {
      cardBg = 'rgba(236,253,245,1)';
      accentBg = 'rgba(16,185,129,1)';
      badgeHTML = '<span style="font-size:26px;line-height:1;">💡</span>';
      labelColor = 'rgba(5,150,105,1)';
    } else if (type === 'flag') {
      cardBg = 'rgba(238,242,255,1)';
      accentBg = 'rgba(99,102,241,1)';
      badgeHTML = '<span style="font-size:26px;line-height:1;">🚩</span>';
      labelColor = 'rgba(79,70,229,1)';
    } else {
      cardBg = 'rgba(217,217,217,1)';
      accentBg = 'rgba(46,82,102,1)';
      var numStr = String(num);
      badgeHTML = '<span style="color:rgba(202,200,188,1);font-size:' + (numStr.length > 1 ? '26px' : '36px') + ';font-family:Inter,sans-serif;line-height:1;">' + numStr + '</span>';
      labelColor = null;
    }

    var card = document.createElement('div');
    card.dataset.stepIndex = index;
    card.style.cssText = [
      'position: relative',
      'background-color: ' + cardBg,
      'border-radius: 5px',
      'margin-bottom: 4px',
      'padding: 18px 80px 18px 110px',
      'box-sizing: border-box',
      'min-height: ' + (isAnnot ? '72px' : '120px'),
      'font-family: Inter, sans-serif',
      'box-shadow: 0 2px 8px rgba(0,0,0,0.15)'
    ].join('; ');

    // Circle / badge
    var circle = document.createElement('div');
    circle.style.cssText = [
      'position: absolute',
      'top: 50%',
      'transform: translateY(-50%)',
      'left: 16px',
      'width: 71px',
      'height: 71px',
      'background-color: ' + accentBg,
      'border-radius: 50%',
      'display: flex',
      'align-items: center',
      'justify-content: center'
    ].join('; ');
    circle.innerHTML = badgeHTML;
    card.appendChild(circle);

    // Delete button
    var deleteBtn = document.createElement('div');
    deleteBtn.style.cssText = [
      'position: absolute',
      'top: 50%',
      'transform: translateY(-50%)',
      'right: 16px',
      'width: 50px',
      'height: 50px',
      'background-color: rgba(200,107,102,0.50)',
      'border-radius: 50%',
      'cursor: pointer',
      'display: flex',
      'align-items: center',
      'justify-content: center'
    ].join('; ');
    deleteBtn.innerHTML = '<span style="color:white;font-size:28px;line-height:1;margin-top:-2px;">&#215;</span>';
    deleteBtn.addEventListener('click', function () {
      showConfirm('Delete this ' + (isAnnot ? type : 'step') + '?', function () {
        steps.splice(index, 1);
        _skipStorageEvent = true;
        chrome.storage.local.set({ steps: steps }, function () {
          _skipStorageEvent = false;
          updateHeaderInfo();
          renderSteps();
        });
      });
    });
    card.appendChild(deleteBtn);

    if (isAnnot) {
      var typeLabel = document.createElement('div');
      typeLabel.style.cssText = 'font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;color:' + labelColor + ';margin-bottom:5px;';
      typeLabel.textContent = type;
      card.appendChild(typeLabel);

      var ta = document.createElement('textarea');
      ta.placeholder = 'Add ' + type + ' text here...';
      ta.value = step.content || '';
      ta.style.cssText = 'width:100%;background:transparent;border:none;outline:none;font-size:15px;font-family:Inter,sans-serif;color:rgba(40,40,40,1);resize:none;min-height:28px;line-height:1.5;overflow:hidden;display:block;';
      ta.rows = 1;
      ta.addEventListener('input', function () {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
      });
      ta.addEventListener('blur', function () {
        steps[index].content = ta.value;
        chrome.storage.local.set({ steps: steps });
      });
      card.appendChild(ta);

    } else if (type === 'text') {
      var ta = document.createElement('textarea');
      ta.placeholder = 'Describe this step...';
      ta.value = step.content || step.description || '';
      ta.style.cssText = 'width:100%;background:transparent;border:none;outline:none;font-size:18px;font-weight:500;font-family:Inter,sans-serif;color:rgba(30,30,30,1);resize:none;min-height:36px;line-height:1.5;overflow:hidden;display:block;';
      ta.rows = 1;
      ta.addEventListener('input', function () {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
      });
      ta.addEventListener('blur', function () {
        steps[index].content = ta.value;
        steps[index].description = ta.value;
        chrome.storage.local.set({ steps: steps });
      });
      card.appendChild(ta);

    } else {
      // Captured step — editable title
      var title = document.createElement('textarea');
      title.value = step.description || 'Click here';
      title.style.cssText = 'width:100%;background:transparent;border:none;outline:none;font-size:20px;font-weight:600;font-family:Inter,sans-serif;color:rgba(0,0,0,1);resize:none;min-height:30px;line-height:1.4;overflow:hidden;display:block;margin-bottom:12px;padding:0;';
      title.rows = 1;
      title.addEventListener('input', function () {
        title.style.height = 'auto';
        title.style.height = title.scrollHeight + 'px';
      });
      title.addEventListener('blur', function () {
        steps[index].description = title.value;
        chrome.storage.local.set({ steps: steps });
      });
      card.appendChild(title);

      if (step.screenshot) {
        var screenshotWrap = document.createElement('div');
        screenshotWrap.style.cssText = 'position:relative;display:block;margin-bottom:10px;';
        var img = document.createElement('img');
        img.src = 'data:image/png;base64,' + step.screenshot;
        img.alt = 'Step ' + num;
        img.style.cssText = 'width:100%;height:auto;display:block;border-radius:3px;';
        screenshotWrap.appendChild(img);

        // Edit button
        var editBtn = document.createElement('button');
        editBtn.textContent = '✏ Edit';
        editBtn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:5;padding:5px 13px;border-radius:6px;border:none;background:rgba(20,20,20,0.72);color:#fff;font-size:12px;font-weight:700;font-family:Inter,sans-serif;cursor:pointer;letter-spacing:0.2px;';
        editBtn.addEventListener('click', function () { openScreenshotEditor(index); });
        screenshotWrap.appendChild(editBtn);

        if (step.clickX != null && step.clickY != null) {
          img.addEventListener('load', function () {
            var pxX = step.clickX * img.offsetWidth;
            var pxY = step.clickY * img.offsetHeight;
            var marker = document.createElement('div');
            marker.style.cssText = 'position:absolute;left:' + pxX + 'px;top:' + pxY + 'px;transform:translate(-50%,-50%);pointer-events:none;';
            marker.innerHTML = '<div style="width:32px;height:32px;border-radius:50%;border:3px solid #e04b2a;background:rgba(224,75,42,0.18);"></div>';
            screenshotWrap.appendChild(marker);
          });
        }
        card.appendChild(screenshotWrap);
      }
    }

    return card;
  }

  function openScreenshotEditor(index) {
    var step = steps[index];
    if (!step.screenshot) return;

    var currentTool = 'redact';
    var markerX = step.clickX != null ? step.clickX : null;
    var markerY = step.clickY != null ? step.clickY : null;
    var committedData = null;
    var isDrawing = false;
    var canvasScale = 1;
    var selStart = null;

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,10,10,0.93);z-index:99999;display:flex;flex-direction:column;';

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 20px;background:rgba(28,28,28,1);border-bottom:1px solid rgba(55,55,55,1);flex-shrink:0;';

    var toolTitle = document.createElement('span');
    toolTitle.textContent = 'Edit Screenshot';
    toolTitle.style.cssText = 'font-family:Inter,sans-serif;font-size:14px;font-weight:700;color:#fff;margin-right:8px;white-space:nowrap;';
    toolbar.appendChild(toolTitle);

    var sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:22px;background:rgba(80,80,80,1);margin:0 4px;';
    toolbar.appendChild(sep);

    var toolDefs = [
      { key: 'redact', label: '⬛ Redact',    tip: 'Draw a black box over content' },
      { key: 'blur',   label: '🌫 Blur',      tip: 'Pixelate a selected region'    },
      { key: 'crop',   label: '✂ Crop',       tip: 'Crop to selection'              },
      { key: 'marker', label: '🔴 Marker',    tip: 'Click to reposition the marker' },
    ];
    var toolBtns = {};
    toolDefs.forEach(function (td) {
      var btn = document.createElement('button');
      btn.textContent = td.label;
      btn.title = td.tip;
      btn.style.cssText = 'padding:5px 13px;border-radius:6px;border:1.5px solid transparent;font-size:12px;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;background:rgba(55,55,55,1);color:#bbb;white-space:nowrap;';
      btn.addEventListener('click', function () { setTool(td.key); });
      toolBtns[td.key] = btn;
      toolbar.appendChild(btn);
    });

    var spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1;';
    toolbar.appendChild(spacer);

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:6px 14px;border-radius:7px;border:1.5px solid rgba(85,85,85,1);background:transparent;color:#aaa;font-size:13px;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;';

    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save changes';
    saveBtn.style.cssText = 'padding:6px 18px;border-radius:7px;border:none;background:rgba(46,82,102,1);color:#fff;font-size:13px;font-weight:700;font-family:Inter,sans-serif;cursor:pointer;';

    toolbar.appendChild(cancelBtn);
    toolbar.appendChild(saveBtn);
    modal.appendChild(toolbar);

    // Canvas scroll area
    var scrollArea = document.createElement('div');
    scrollArea.style.cssText = 'flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:32px;';

    var canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'position:relative;display:inline-block;line-height:0;';

    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;cursor:crosshair;box-shadow:0 4px 28px rgba(0,0,0,0.6);border-radius:3px;';

    var markerLayer = document.createElement('div');
    markerLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

    canvasWrap.appendChild(canvas);
    canvasWrap.appendChild(markerLayer);
    scrollArea.appendChild(canvasWrap);
    modal.appendChild(scrollArea);
    document.body.appendChild(modal);

    function setTool(key) {
      currentTool = key;
      Object.keys(toolBtns).forEach(function (k) {
        toolBtns[k].style.background = 'rgba(55,55,55,1)';
        toolBtns[k].style.color = '#bbb';
        toolBtns[k].style.borderColor = 'transparent';
      });
      toolBtns[key].style.background = 'rgba(255,255,255,0.14)';
      toolBtns[key].style.color = '#fff';
      toolBtns[key].style.borderColor = 'rgba(255,255,255,0.28)';
    }

    function drawMarker() {
      markerLayer.innerHTML = '';
      if (markerX == null || markerY == null) return;
      var cw = parseFloat(canvas.style.width) || canvas.width;
      var ch = parseFloat(canvas.style.height) || canvas.height;
      var dot = document.createElement('div');
      dot.style.cssText = 'position:absolute;left:' + (markerX * cw) + 'px;top:' + (markerY * ch) + 'px;transform:translate(-50%,-50%);width:32px;height:32px;border-radius:50%;border:3px solid #e04b2a;background:rgba(224,75,42,0.25);box-sizing:border-box;';
      markerLayer.appendChild(dot);
    }

    function getPos(e) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width  / rect.width),
        y: (e.clientY - rect.top)  * (canvas.height / rect.height)
      };
    }

    var img = new Image();
    img.onload = function () {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      committedData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      var availW = scrollArea.clientWidth  - 64;
      var availH = scrollArea.clientHeight - 64;
      canvasScale = Math.min(1, availW / canvas.width, availH / canvas.height);
      canvas.style.width  = Math.round(canvas.width  * canvasScale) + 'px';
      canvas.style.height = Math.round(canvas.height * canvasScale) + 'px';

      drawMarker();
      setTool('redact');

      canvas.addEventListener('mousedown', function (e) {
        if (currentTool === 'marker') {
          var rect = canvas.getBoundingClientRect();
          markerX = (e.clientX - rect.left) / rect.width;
          markerY = (e.clientY - rect.top)  / rect.height;
          drawMarker();
          return;
        }
        isDrawing = true;
        selStart = getPos(e);
      });

      canvas.addEventListener('mousemove', function (e) {
        if (!isDrawing || !selStart) return;
        var pos = getPos(e);
        var rx = Math.min(selStart.x, pos.x), ry = Math.min(selStart.y, pos.y);
        var rw = Math.abs(pos.x - selStart.x), rh = Math.abs(pos.y - selStart.y);
        ctx.putImageData(committedData, 0, 0);
        ctx.save();
        ctx.strokeStyle = currentTool === 'crop' ? '#facc15' : '#fff';
        ctx.lineWidth = Math.max(1, 2 / canvasScale);
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.restore();
      });

      canvas.addEventListener('mouseup', function (e) {
        if (!isDrawing || !selStart) return;
        isDrawing = false;
        var pos = getPos(e);
        var rx = Math.min(selStart.x, pos.x), ry = Math.min(selStart.y, pos.y);
        var rw = Math.abs(pos.x - selStart.x), rh = Math.abs(pos.y - selStart.y);
        selStart = null;
        ctx.setLineDash([]);
        ctx.putImageData(committedData, 0, 0);
        if (rw < 4 || rh < 4) return;

        if (currentTool === 'redact') {
          ctx.fillStyle = '#111';
          ctx.fillRect(rx, ry, rw, rh);

        } else if (currentTool === 'blur') {
          var pxSz = Math.max(6, Math.round(Math.min(rw, rh) / 15));
          var tC = document.createElement('canvas');
          tC.width  = Math.max(1, Math.round(rw / pxSz));
          tC.height = Math.max(1, Math.round(rh / pxSz));
          var tX = tC.getContext('2d');
          tX.imageSmoothingEnabled = false;
          tX.drawImage(canvas, rx, ry, rw, rh, 0, 0, tC.width, tC.height);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tC, 0, 0, tC.width, tC.height, rx, ry, rw, rh);
          ctx.imageSmoothingEnabled = true;

        } else if (currentTool === 'crop') {
          var origW = canvas.width, origH = canvas.height;
          rx = Math.round(rx); ry = Math.round(ry);
          rw = Math.round(rw); rh = Math.round(rh);
          var cropData = ctx.getImageData(rx, ry, rw, rh);
          canvas.width  = rw;
          canvas.height = rh;
          ctx.putImageData(cropData, 0, 0);
          canvas.style.width  = Math.round(rw * canvasScale) + 'px';
          canvas.style.height = Math.round(rh * canvasScale) + 'px';
          if (markerX != null) {
            markerX = (markerX * origW - rx) / rw;
            markerY = (markerY * origH - ry) / rh;
            if (markerX < 0 || markerX > 1 || markerY < 0 || markerY > 1) {
              markerX = null; markerY = null;
            }
          }
          drawMarker();
        }

        committedData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      });
    };
    img.src = 'data:image/png;base64,' + step.screenshot;

    function close() {
      document.body.removeChild(modal);
      document.removeEventListener('keydown', onKey);
    }

    saveBtn.addEventListener('click', function () {
      var dataUrl = canvas.toDataURL('image/png');
      var base64 = dataUrl.replace('data:image/png;base64,', '');

      steps[index].screenshot = base64;
      steps[index].clickX = markerX;
      steps[index].clickY = markerY;

      var card = stepsContainer && stepsContainer.querySelector('[data-step-index="' + index + '"]');
      if (card) {
        var cardImg = card.querySelector('img');
        if (cardImg) cardImg.src = dataUrl;
      }

      close();

      _skipStorageEvent = true;
      chrome.storage.local.set({ steps: steps }, function () {
        _skipStorageEvent = false;
        renderSteps();
      });
    });

    cancelBtn.addEventListener('click', close);

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
  }

  function autoResizeTA(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function deriveTitle() {
    var capturedStep = steps.find(function (s) { return s.pageUrl; });
    if (!capturedStep) return 'SOP Guide';
    var appName = '';
    try {
      var host = new URL(capturedStep.pageUrl).hostname;
      var parts = host.split('.');
      appName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
      appName = appName.charAt(0).toUpperCase() + appName.slice(1);
    } catch (e) {
      appName = capturedStep.pageTitle || '';
    }
    var procedureSteps = steps.filter(function (s) { return !s.type || s.type === 'text'; });
    var firstAction = '';
    for (var i = 0; i < procedureSteps.length; i++) {
      var d = (procedureSteps[i].description || procedureSteps[i].elementText || '').trim();
      if (d && d.length > 2 && d.length < 60 && !/^(click on )?(div|span|button|a|input|li|ul|img|svg)$/i.test(d)) {
        firstAction = d.charAt(0).toLowerCase() + d.slice(1);
        break;
      }
    }
    if (appName && firstAction) return 'How to ' + firstAction + ' in ' + appName;
    if (appName) return 'How to use ' + appName;
    return 'SOP Guide';
  }

  function deriveSummary() {
    var capturedStep = steps.find(function (s) { return s.pageUrl; });
    var appName = '';
    if (capturedStep) {
      try {
        var host = new URL(capturedStep.pageUrl).hostname;
        var parts = host.split('.');
        appName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        appName = appName.charAt(0).toUpperCase() + appName.slice(1);
      } catch (e) {}
    }
    var procedureSteps = steps.filter(function (s) { return !s.type || s.type === 'text'; });
    var count = procedureSteps.length;
    var actions = procedureSteps
      .map(function (s) { return (s.description || s.elementText || '').trim(); })
      .filter(function (d) { return d && d.length > 3 && !/^(click on )?(div|span|button|a|input|li|ul|img|svg)$/i.test(d); })
      .slice(0, 4);
    var s = 'This ' + count + '-step guide';
    if (appName) s += ' walks through the workflow on ' + appName;
    s += '.';
    if (actions.length === 1) {
      s += ' It covers ' + actions[0].charAt(0).toLowerCase() + actions[0].slice(1) + '.';
    } else if (actions.length === 2) {
      s += ' Steps include ' + actions[0].toLowerCase() + ' and ' + actions[1].toLowerCase() + '.';
    } else if (actions.length >= 3) {
      var last = actions.pop();
      s += ' Steps include ' + actions.map(function (a) { return a.toLowerCase(); }).join(', ') + ', and ' + last.toLowerCase() + '.';
    }
    return s;
  }

  function buildSopIntro() {
    if (!stepsContainer || steps.length === 0) return;
    chrome.storage.local.get(['sopTitle', 'sopSummary'], function (result) {
      var title   = (result.sopTitle   != null) ? result.sopTitle   : deriveTitle();
      var summary = (result.sopSummary != null) ? result.sopSummary : deriveSummary();
      if (result.sopTitle   == null) chrome.storage.local.set({ sopTitle:   title   });
      if (result.sopSummary == null) chrome.storage.local.set({ sopSummary: summary });

      sopIntroEl = document.createElement('div');
      sopIntroEl.setAttribute('data-sop-intro', '1');
      sopIntroEl.style.cssText = 'display:flex;gap:40px;align-items:flex-start;background:rgba(255,255,255,0.72);border-radius:12px;padding:28px 32px 26px;margin-bottom:4px;position:relative;';

      var left = document.createElement('div');
      left.style.cssText = 'flex:1.6;min-width:0;';

      var label = document.createElement('div');
      label.textContent = 'SOP TITLE';
      label.style.cssText = 'font-family:Inter,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.2px;color:rgba(46,82,102,0.6);margin-bottom:8px;text-transform:uppercase;';

      var titleTA = document.createElement('textarea');
      titleTA.value = title;
      titleTA.rows = 1;
      titleTA.style.cssText = 'display:block;width:100%;background:transparent;border:none;outline:none;font-family:Inter,sans-serif;font-size:30px;font-weight:700;color:rgba(15,23,42,1);line-height:1.25;resize:none;overflow:hidden;padding:0;letter-spacing:-0.4px;';
      titleTA.addEventListener('input', function () { autoResizeTA(titleTA); });
      titleTA.addEventListener('blur',  function () { chrome.storage.local.set({ sopTitle: titleTA.value }); });

      left.appendChild(label);
      left.appendChild(titleTA);

      var right = document.createElement('div');
      right.style.cssText = 'flex:1;min-width:0;padding-top:4px;';

      var summLabel = document.createElement('div');
      summLabel.textContent = 'SUMMARY';
      summLabel.style.cssText = 'font-family:Inter,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.2px;color:rgba(46,82,102,0.6);margin-bottom:8px;text-transform:uppercase;';

      var summaryTA = document.createElement('textarea');
      summaryTA.value = summary;
      summaryTA.style.cssText = 'display:block;width:100%;background:transparent;border:none;outline:none;font-family:Inter,sans-serif;font-size:14px;color:rgba(51,65,85,1);line-height:1.75;resize:none;overflow:hidden;padding:0;';
      summaryTA.addEventListener('input', function () { autoResizeTA(summaryTA); });
      summaryTA.addEventListener('blur',  function () { chrome.storage.local.set({ sopSummary: summaryTA.value }); });

      var regenBtn = document.createElement('button');
      regenBtn.textContent = '↺ Regenerate';
      regenBtn.title = 'Re-derive title and summary from current steps';
      regenBtn.style.cssText = 'display:inline-block;margin-top:14px;background:transparent;border:1px solid rgba(46,82,102,0.25);color:rgba(46,82,102,0.7);border-radius:6px;padding:4px 11px;font-size:11px;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;letter-spacing:0.2px;';
      regenBtn.addEventListener('click', function () {
        titleTA.value   = deriveTitle();
        summaryTA.value = deriveSummary();
        autoResizeTA(titleTA);
        autoResizeTA(summaryTA);
        chrome.storage.local.set({ sopTitle: titleTA.value, sopSummary: summaryTA.value });
      });

      right.appendChild(summLabel);
      right.appendChild(summaryTA);
      right.appendChild(regenBtn);

      sopIntroEl.appendChild(left);
      sopIntroEl.appendChild(right);

      stepsContainer.insertBefore(sopIntroEl, stepsContainer.firstChild);

      autoResizeTA(titleTA);
      autoResizeTA(summaryTA);
    });
  }

  function loadSteps() {
    chrome.storage.local.get('steps', function (result) {
      steps = result.steps || [];
      updateHeaderInfo();
      renderSteps();
      if (steps.length > 0) buildSopIntro();
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (_skipStorageEvent) return;
    if (area === 'local' && changes.steps) {
      var focused = document.activeElement;
      var isTyping = focused && focused.tagName === 'TEXTAREA' && stepsContainer && stepsContainer.contains(focused);
      steps = changes.steps.newValue || [];
      updateHeaderInfo();
      if (steps.length === 0) {
        sopIntroEl = null;
        chrome.storage.local.remove(['sopTitle', 'sopSummary']);
      }
      if (!isTyping) {
        renderSteps();
        if (steps.length > 0 && !sopIntroEl) buildSopIntro();
      }
    }
  });

  loadSteps();
});
