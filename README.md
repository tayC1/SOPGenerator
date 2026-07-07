# CODEX

A full featured Knowledge Base/SOP builder, directly engineered and designed to tie into KRAMER PRO's internal tools.This tool is designed to help teams streamline documentation that they build, to help ensure consistency across processes. 

## Features

✅ **Click recording** - Automatically captures every click, along with metadata (element text, tag name, page title, URL)

✅ **Screenshots** - Takes a screenshot after each click and stores it as base64

✅ **Live recording indicator** - Visual overlay confirms recording is active

✅ **Review & edit** - Step through everything captured and edit descriptions as needed

✅ **Reorder steps** - Drag and drop to reorganize out-of-sequence steps

✅ **Delete steps** - Remove unwanted or accidental steps before export

✅ **Export to Markdown** - Generates a clean SOP document with screenshots embedded inline

✅ **No external dependencies** - Vanilla JavaScript, nothing else to install or maintain

✅ **Manifest V3** - Built to the current Chrome extension standard

## Installation

1. Clone or download this repository
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked" and select the folder
5. The extension icon will appear in your toolbar

## Usage

### Recording a workflow

1. Click the CODEX icon to open the popup
2. Click **Record** to begin
3. A red "Recording..." indicator appears in the top-right corner
4. Proceed through the workflow as normal — each click is captured
5. Click **Stop** when finished

### Reviewing steps

1. Click **Review Steps** after stopping the recording
2. A new tab opens with all captured steps
3. Each step displays:
   - The screenshot taken immediately after the click
   - Page title, URL, and the clicked element
   - An editable description field

### Editing steps

**Edit description:** Click into the description field under any step and update the text

**Reorder:** Drag the ⋮⋮ handle to move a step

**Delete:** Click "Delete" to remove a step

### Exporting to Markdown

1. From the Review tab, click **Export as MD**
2. A markdown file downloads
3. The export includes:
   - All steps numbered with descriptions
   - Screenshots embedded as base64 images
   - Metadata (page title, URL, clicked element, timestamp)

## File structure

- **manifest.json** - Extension configuration (Manifest V3)
- **background.js** - Service worker handling screenshot capture and storage
- **content.js** - Content script handling click detection and the recording overlay
- **popup.html** - Popup UI for record/stop controls
- **popup.js** - Popup logic and storage management
- **review.html** - Review page UI
- **review.js** - Review page logic (edit, reorder, delete, export)

## How it works

1. **Recording** - Clicking Record triggers content.js to begin listening for clicks on the page
2. **Click detection** - Each click captures element text, tag name, page title, and URL
3. **Screenshot capture** - background.js receives the click data and calls `chrome.tabs.captureVisibleTab()`
4. **Storage** - Steps (screenshots + metadata) are saved to `chrome.storage.local`
5. **Review** - review.html loads steps from storage and displays them
6. **Export** - Steps are converted to Markdown with base64-encoded images

## Technical notes

- `captureVisibleTab()` is called exclusively from the background.js service worker, in line with security best practices
- Content script is dynamically injected if not already loaded
- Each step object in storage follows this structure:
  ```json
  {
    "id": "timestamp",
    "screenshot": "base64_string",
    "elementText": "clicked text",
    "tagName": "button|a|div|etc",
    "pageTitle": "page title",
    "pageUrl": "https://...",
    "timestamp": "ISO_string",
    "description": "user_entered_description"
  }
  ```

## Troubleshooting

**Recording isn't working**
- Confirm the extension has permission to run on the site
- Try refreshing the page after clicking Record
- Check the developer console for errors

**Screenshots are black or blank**
- This can occur on protected pages (banking sites, etc.) due to Chrome's screenshot restrictions

**Review page won't open**
- Confirm at least one step has been captured
- Check that pop-ups aren't blocked for the extension

**Export file is empty**
- Allow a moment after stopping recording for steps to finish saving
- Confirm steps are present in the Review tab before exporting

## Tips

- Click on meaningful buttons/links so element text is descriptive
- Refine descriptions in the Review tab for clarity in the final SOP
- Reorder steps to correct sequencing issues
- Remove accidental clicks before exporting

## Security & privacy

- All data is stored locally via `chrome.storage.local` — nothing is sent externally
- Screenshots are limited to tabs under your own control
- Data can be cleared at any time using the Clear button in the popup

## Limitations

- Cannot record clicks on Chrome UI elements or other extensions
- Sites with strict CSP (Content Security Policy) may block recording
- Screenshot capture is subject to Chrome's built-in restrictions
- Storage capacity depends on your Chrome profile settings (typically 10MB+)

## Future enhancements

Planned or potential additions:
- Pause/resume recording
- Keyboard input recording
- Form field detection and auto-fill suggestions
- Multiple workflow templates
- Optional cloud sync
- PDF export format
- Collaborative SOP sharing

---

**Built to streamline SOP documentation. 📋**

## Copyright

© 2026 Taylor Giba. All rights reserved.