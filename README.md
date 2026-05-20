# Scribe Clone - Chrome Extension

A Chrome extension that records your workflow (clicks and screenshots) and generates structured SOP (Standard Operating Procedure) documents in Markdown format.

## Features

✅ **Record Clicks** - Automatically captures each click with metadata (element text, tag name, page title, URL)

✅ **Screenshots** - Takes a screenshot after each click and stores as base64

✅ **Live Recording Indicator** - Visual overlay showing recording is active

✅ **Review & Edit** - View all steps with editable descriptions

✅ **Reorder Steps** - Drag and drop to reorganize steps

✅ **Delete Steps** - Remove unwanted steps before export

✅ **Export to Markdown** - Generate a beautiful SOP document with embedded screenshots

✅ **No External Dependencies** - Vanilla JavaScript only

✅ **Manifest V3** - Modern Chrome extension format

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the folder containing these files
5. The Scribe Clone icon will appear in your Chrome toolbar

## Usage

### Recording a Workflow

1. Click the Scribe Clone extension icon to open the popup
2. Click the **Record** button to start recording
3. A red "Recording..." indicator will appear in the top-right corner of the page
4. Interact with the page as you normally would - each click is captured
5. Click the **Stop** button when done

### Reviewing Steps

1. After recording, click the **Review Steps** button
2. A new tab opens showing all captured steps
3. Each step displays:
   - The screenshot taken after the click
   - Page title, URL, and clicked element info
   - An editable description field

### Editing Steps

**Edit Description:** Click in the description field under each step and update the text

**Reorder Steps:** Click and drag the ⋮⋮ handle to reorder steps

**Delete Step:** Click the "Delete" button to remove a step

### Exporting to Markdown

1. In the Review tab, click **Export as MD**
2. A markdown file will download to your computer
3. The file includes:
   - All steps numbered with descriptions
   - Screenshots embedded as base64 images
   - Metadata (page title, URL, clicked element, timestamp)

## File Structure

- **manifest.json** - Extension configuration (Manifest V3)
- **background.js** - Service worker handling screenshot capture and storage
- **content.js** - Content script for click detection and overlay
- **popup.html** - Popup UI for record/stop controls
- **popup.js** - Popup logic and storage management
- **review.html** - Review page UI for viewing and editing steps
- **review.js** - Review page logic (edit, reorder, delete, export)

## How It Works

1. **Recording** - When you click Record, content.js starts listening for clicks on the page
2. **Click Detection** - Each click captures element text, tag name, page title, and URL
3. **Screenshot Capture** - background.js receives the click data and calls `chrome.tabs.captureVisibleTab()`
4. **Storage** - Steps (screenshots + metadata) are saved to `chrome.storage.local`
5. **Review** - The review.html page loads steps from storage and displays them
6. **Export** - Steps are converted to Markdown with base64-encoded images

## Technical Details

- **captureVisibleTab()** - Only called from background.js service worker per security best practices
- **Content Script Injection** - Dynamically injected if not already loaded
- **Storage Format** - Each step object contains:
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
- Make sure the extension has permission to run on the site
- Try refreshing the page after clicking Record
- Check the Chrome developer console for errors

**Screenshots are black or blank**
- This might happen on some protected pages (banks, etc.)
- The extension respects Chrome's screenshot limitations

**Review page won't open**
- Make sure you have captured at least one step
- Check that pop-ups aren't blocked for this extension

**Export file is empty**
- Wait a moment after stopping recording for all steps to save
- Verify you have steps in the Review tab before exporting

## Tips

- Use descriptive element text by clicking on meaningful buttons/links
- Edit descriptions in the Review tab to make the SOP clearer
- Reorder steps if you make a mistake in your workflow
- Delete any accidental clicks before exporting
- The markdown file can be opened in any text editor or markdown viewer

## Security & Privacy

- All data is stored locally in `chrome.storage.local` - nothing is sent to external servers
- Screenshots are only taken of tabs you control
- You can clear data by clicking the Clear button in the popup

## Limitations

- Cannot record clicks on Chrome UI elements or other extensions
- Some websites with strict CSP (Content Security Policy) may not allow recording
- Screenshots respect the browser's screenshot limitations (can't capture certain protected content)
- Maximum storage depends on your Chrome profile settings (usually 10MB+)

## Future Enhancements

Potential features to add:
- Pause/Resume recording
- Keyboard input recording
- Form field detection and auto-fill suggestions
- Multiple workflow templates
- Cloud sync (optional)
- PDF export format
- Collaborative SOP sharing

## License

Created as an educational project. Feel free to modify for your needs!

---

**Enjoy automating your SOP documentation! 📋**

## Copyright

© 2026 Taylor Giba. All rights reserved.
