# AGENTS.md

This file provides coding‑mode guidance for agents working on this repository.

## Non‑obvious coding conventions
- Always use the **safeFile** wrapper from `AOE/content-main.js` when creating `File` objects; direct `new File()` bypasses the text‑upload hack.
- When inserting text into the chat input, set `el.textContent` **instead of** `value` because the element is `contenteditable`.
- After modifying the DOM, always dispatch both `input` **and** `change` events so the webapp picks up the change.
- Image insertion prefers the HTML `<img>` method; only fall back to a synthetic `paste` event if the HTML approach throws.
- Extension scripts must be (re)registered **after** updating `chrome.storage.local` keys (`savedTargetUrl`, `savedIframeUrl`).
- Debug logs appear in the **Extension Host** output channel; they are **not** visible in the page console.

## Gotchas
- Registering a content script without first unregistering the previous one results in silent failure.
- The file‑upload hack only triggers when the filename starts with `Pasted_Text_` **and** the internal `isAskAi` flag is true.
- Screenshot capture (`chrome.tabs.captureVisibleTab`) cannot run on `chrome://` or `file://` pages.
