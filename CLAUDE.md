# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension that automatically replies to YouTube comments using Zhipu AI's models. The extension monitors YouTube video pages for new comments and generates contextually appropriate replies using the configured AI model.

## File Structure

```
youtube-ai-reply/
├── manifest.json          # Extension configuration file
├── background.js          # Background script handling API calls
├── content.js            # Content script monitoring YouTube pages
├── popup.html            # Popup UI interface
├── popup.js              # Popup UI logic
├── styles.css            # Styling for popup UI
├── README.md             # Project documentation
├── INSTALL.md            # Installation instructions
└── test.js               # Simple test script
```

## Architecture

### Core Components

1. **Manifest File**: Defines extension permissions, content scripts, and background service worker
2. **Background Script**: Handles Zhipu AI API calls and storage management
3. **Content Script**: Monitors YouTube pages for comments using MutationObserver
4. **Popup UI**: Provides configuration interface for users

### Key Features

- Auto-detection of new YouTube comments
- AI-powered reply generation using Gemini
- Configurable reply styles (friendly, professional, casual, humorous)
- Reply delay and daily limit controls
- API status monitoring and statistics tracking

## Development Commands

There are no specific build or development commands for this project as it's a client-side Chrome extension. Development involves editing the JavaScript/HTML/CSS files directly.

To test the extension:
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the project directory
4. Test functionality on YouTube video pages

## Common Development Tasks

### Adding New Reply Styles
1. Update the `stylePrompts` object in `background.js`
2. Add new option to the select element in `popup.html`
3. Update popup UI logic in `popup.js` if needed

### Modifying Comment Detection
1. Adjust selectors in `content.js`:
   - `isCommentElement()` method for identifying comment elements
   - `extractCommentText()` method for extracting comment content
   - `findReplyButton()`, `findReplyInput()`, `findPostButton()` methods for UI interaction

### Changing API Integration
1. Modify the `generateReply()` method in `background.js`
2. Update the prompt construction in `buildPrompt()` method
3. Adjust error handling as needed

## Important Implementation Details

### Content Script Architecture
- Uses MutationObserver to detect dynamically loaded comments
- Maintains a Set of processed comment IDs to avoid duplicates
- Implements a reply queue with configurable delays
- Handles YouTube's dynamic UI with multiple fallback selectors

### Background Script Responsibilities
- Manages Chrome storage for settings and statistics
- Handles Gemini API communication
- Provides message passing interface for content script

### Popup UI Features
- Real-time settings synchronization
- API key validation and testing
- Reply statistics display
- Comprehensive configuration options

## Testing

Run the test script with Node.js:
```bash
node test.js
```

For manual testing:
1. Load extension in Chrome
2. Open YouTube video with comments
3. Configure API key in popup
4. Enable auto-reply functionality
5. Monitor console logs for debugging information

## Security Considerations

- API keys are stored in Chrome's secure storage
- All API communication uses HTTPS
- Content script runs in isolated world
- No external servers or data collection