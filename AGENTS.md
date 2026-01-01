# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Overview
AOE (Ask Open WebUI Everywhere) is a Chrome/Edge browser extension that integrates Open WebUI into the browser's side panel. This is a pure JavaScript extension with no build system or package manager.

## Critical Architecture Patterns

### Content Script Injection Strategy
- Uses dual-world injection: `content-bridge.js` runs in isolated world, `content-main.js` runs in main world (`"world": "MAIN"`)
- Bridge script must run at `document_start` to establish message passing before main script loads
- Dynamic script registration/unregistration prevents conflicts when URLs change

### Text Extraction Mechanism
- Custom DOM parser filters 13 specific tags: `['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CANVAS', 'SVG', 'HEADER', 'FOOTER', 'NAV', 'TEXTAREA', 'SELECT', 'APPLET', 'MAP']`
- Uses visibility checking (`display !== 'none' && visibility !== 'hidden' && opacity !== '0' && offsetWidth > 0 && offsetHeight > 0`) to exclude hidden content
- Text is extracted recursively with depth-based processing to avoid duplication

### File Upload Hack
- Exploits Open WebUI's 1000+ character auto-file-upload feature by injecting dummy text then replacing with real content
- Overrides native `window.File` constructor to intercept file creation during paste events
- Uses `DataTransfer` and `ClipboardEvent` to simulate user paste actions

### Cross-Origin Communication
- Side panel communicates with content scripts via `postMessage` through iframe
- Content bridge translates messages to custom DOM events for main world script
- All messages use `'*'` origin for maximum compatibility (security consideration)

## Browser Extension Specifics

### Manifest V3 Requirements
- Service worker background script (not persistent background page)
- Requires `sidePanel`, `scripting`, `activeTab`, `tabs`, `storage` permissions
- Uses `<all_urls>` host permission for dynamic content script injection

### Storage Patterns
- Uses `chrome.storage.local` for persistence across extension restarts
- Configuration keys: `savedTargetUrl` (for content scripts), `savedIframeUrl` (for side panel)
- Storage updates trigger dynamic script re-registration

## Development Gotchas

### Content Script Registration
- Must unregister existing scripts before registering new ones to prevent conflicts
- Registration fails silently if URL patterns are invalid - always check console
- Scripts persist across extension reloads until explicitly unregistered

### Screenshot Capture
- `chrome.tabs.captureVisibleTab` requires active tab permission and can fail on certain pages (chrome://, file://, etc.)
- Returns data URL that must be converted to File object before injection

### Open WebUI Integration
- Extension assumes Open WebUI has "Paste Large Text as File" setting enabled
- Targets specific DOM element `#chat-input` for paste events
- File naming convention: `Pasted_Text_` prefix triggers the override mechanism