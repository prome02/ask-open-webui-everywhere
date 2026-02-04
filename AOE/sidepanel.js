const webview = document.getElementById('targetFrame');
const refreshBtn = document.getElementById('refreshBtn');
const screenBtn = document.getElementById('screenBtn');
const pasteBtn = document.getElementById('pasteBtn');
const statusTag = document.querySelector('.status-tag');
const statusDot = document.querySelector('.status-dot');

let savedUrl = '';
let keepAliveTimer = null;
let healthCheckTimer = null;
const KEEP_ALIVE_INTERVAL = 2 * 60 * 1000; // 2 minutes
const HEALTH_CHECK_INTERVAL = 10 * 1000; // 10 seconds (shorter for debug)
const MAX_AUTO_RETRIES = 3;
let autoRetryCount = 0;
let iframeLoadCount = 0;
let lastLoadTime = null;

// Debug logger with timestamp
function log(tag, msg, data) {
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[AOE ${ts}][${tag}] ${msg}`, data);
  } else {
    console.log(`[AOE ${ts}][${tag}] ${msg}`);
  }
}

// Log iframe state for debugging
function logIframeState() {
  log('STATE', 'iframe.src = ' + webview.src);
  log('STATE', 'iframe.contentWindow exists = ' + !!webview.contentWindow);
  try {
    const loc = webview.contentWindow.location.href;
    log('STATE', 'iframe.contentWindow.location.href = ' + loc);
  } catch (e) {
    log('STATE', 'iframe.contentWindow.location: cross-origin blocked (this is normal for external URLs)');
  }
  try {
    const doc = webview.contentDocument;
    if (doc) {
      log('STATE', 'iframe.contentDocument accessible = true');
      log('STATE', 'iframe document.readyState = ' + doc.readyState);
      log('STATE', 'iframe document.title = ' + doc.title);
      const bodyText = doc.body ? doc.body.innerText.substring(0, 500) : '(no body)';
      log('STATE', 'iframe body text (first 500 chars) = ' + bodyText);
    } else {
      log('STATE', 'iframe.contentDocument = null');
    }
  } catch (e) {
    log('STATE', 'iframe.contentDocument: cross-origin blocked (this is normal for external URLs)');
  }
}

// Status update helper
function setStatus(state) {
  if (!statusTag || !statusDot) return;
  log('STATUS', 'Status changed to: ' + state);
  const statusText = statusTag.lastChild;
  if (state === 'ready') {
    statusDot.style.background = '#10b981';
    statusText.textContent = 'Ready';
    statusTag.style.background = 'rgba(16, 185, 129, 0.1)';
    statusTag.style.color = '#10b981';
    statusTag.style.borderColor = 'rgba(16, 185, 129, 0.2)';
  } else if (state === 'error') {
    statusDot.style.background = '#ef4444';
    statusText.textContent = 'Error';
    statusTag.style.background = 'rgba(239, 68, 68, 0.1)';
    statusTag.style.color = '#ef4444';
    statusTag.style.borderColor = 'rgba(239, 68, 68, 0.2)';
  } else if (state === 'reconnecting') {
    statusDot.style.background = '#f59e0b';
    statusText.textContent = 'Reconnecting';
    statusTag.style.background = 'rgba(245, 158, 11, 0.1)';
    statusTag.style.color = '#f59e0b';
    statusTag.style.borderColor = 'rgba(245, 158, 11, 0.2)';
  } else if (state === 'loading') {
    statusDot.style.background = '#3b82f6';
    statusText.textContent = 'Loading';
    statusTag.style.background = 'rgba(59, 130, 246, 0.1)';
    statusTag.style.color = '#3b82f6';
    statusTag.style.borderColor = 'rgba(59, 130, 246, 0.2)';
  }
}

// Reload the iframe
function reloadIframe() {
  if (savedUrl) {
    log('RELOAD', 'Reloading iframe with URL: ' + savedUrl);
    setStatus('loading');
    webview.src = savedUrl;
  } else {
    log('RELOAD', 'No savedUrl, cannot reload');
  }
}

// Start keep-alive: periodically ping the iframe to prevent session timeout
function startKeepAlive() {
  stopKeepAlive();
  log('KEEPALIVE', 'Starting keep-alive timer (interval: ' + KEEP_ALIVE_INTERVAL + 'ms)');
  keepAliveTimer = setInterval(() => {
    try {
      if (webview.contentWindow) {
        webview.contentWindow.postMessage({ type: 'AOE_KEEP_ALIVE' }, '*');
        log('KEEPALIVE', 'Ping sent');
      } else {
        log('KEEPALIVE', 'No contentWindow available, iframe may be dead');
      }
    } catch (e) {
      log('KEEPALIVE', 'Ping failed with error: ' + e.message);
    }
  }, KEEP_ALIVE_INTERVAL);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    log('KEEPALIVE', 'Stopping keep-alive timer');
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// Health check: detect if the iframe content has encountered an error
function startHealthCheck() {
  stopHealthCheck();
  log('HEALTH', 'Starting health check timer (interval: ' + HEALTH_CHECK_INTERVAL + 'ms)');
  healthCheckTimer = setInterval(() => {
    checkIframeHealth();
  }, HEALTH_CHECK_INTERVAL);
}

function stopHealthCheck() {
  if (healthCheckTimer) {
    log('HEALTH', 'Stopping health check timer');
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

let consecutiveFailures = 0;
let serverWasDown = false;

async function checkIframeHealth() {
  log('HEALTH', '--- Health check start ---');
  log('HEALTH', 'iframe.src = ' + webview.src);

  // Check if iframe src became empty or about:blank unexpectedly
  if (savedUrl && (webview.src === '' || webview.src === 'about:blank')) {
    log('HEALTH', 'iframe src is blank but savedUrl exists, this is abnormal');
    handleIframeError('iframe src became blank');
    return;
  }

  // Use fetch to probe server health (bypasses cross-origin iframe limitation)
  if (!savedUrl) return;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    log('HEALTH', 'Fetching server: ' + savedUrl);
    const response = await fetch(savedUrl, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // mode: 'no-cors' returns opaque response (status=0, type='opaque')
    // If fetch succeeds at all, the server is reachable
    log('HEALTH', 'Fetch result: type=' + response.type + ', status=' + response.status);

    if (response.type === 'opaque' || response.ok) {
      // Server is reachable
      if (serverWasDown) {
        log('HEALTH', 'Server recovered! Auto-reloading iframe.');
        serverWasDown = false;
        consecutiveFailures = 0;
        autoRetryCount = 0;
        reloadIframe();
      } else {
        consecutiveFailures = 0;
        log('HEALTH', 'Server is reachable - OK');
      }
    } else {
      // Got a response but it's an error status
      consecutiveFailures++;
      log('HEALTH', 'Server returned error status: ' + response.status + ' (failures: ' + consecutiveFailures + ')');
      if (consecutiveFailures >= 2) {
        serverWasDown = true;
        handleIframeError('Server HTTP ' + response.status);
      }
    }
  } catch (e) {
    consecutiveFailures++;
    log('HEALTH', 'Fetch failed: ' + e.message + ' (failures: ' + consecutiveFailures + ')');

    if (e.name === 'AbortError') {
      log('HEALTH', 'Request timed out (8s)');
    }

    // Require 2 consecutive failures to avoid false positives from transient network issues
    if (consecutiveFailures >= 2) {
      serverWasDown = true;
      handleIframeError('Server unreachable: ' + e.message);
    }
  }
}

// Handle iframe errors with auto-retry
function handleIframeError(reason) {
  log('ERROR', 'Error detected. Reason: ' + (reason || 'unknown'));
  stopKeepAlive();
  stopHealthCheck();

  if (autoRetryCount < MAX_AUTO_RETRIES) {
    autoRetryCount++;
    const delay = 2000 * autoRetryCount;
    log('ERROR', 'Auto-retry ' + autoRetryCount + '/' + MAX_AUTO_RETRIES + ', will reload in ' + delay + 'ms');
    setStatus('reconnecting');
    setTimeout(() => {
      reloadIframe();
    }, delay);
  } else {
    log('ERROR', 'Max auto-retries (' + MAX_AUTO_RETRIES + ') reached. Manual refresh required.');
    setStatus('error');
  }
}

// Listen for iframe load events
webview.addEventListener('load', () => {
  iframeLoadCount++;
  const now = new Date();
  const elapsed = lastLoadTime ? (now - lastLoadTime) + 'ms' : 'first load';
  lastLoadTime = now;
  log('IFRAME', 'Load event fired (count: ' + iframeLoadCount + ', since last: ' + elapsed + ')');
  log('IFRAME', 'Current src: ' + webview.src);
  logIframeState();
  autoRetryCount = 0;
  setStatus('ready');
  startKeepAlive();
  startHealthCheck();
});

// Listen for iframe error events
webview.addEventListener('error', (e) => {
  log('IFRAME', 'Error event fired');
  log('IFRAME', 'Error details: ' + (e.message || 'no message'));
  logIframeState();
  handleIframeError('iframe error event');
});

// Listen for messages from iframe
window.addEventListener('message', (event) => {
  if (event.data && event.data.type) {
    log('MSG', 'Received message from iframe: type=' + event.data.type + ', origin=' + event.origin);
  }
});

// 1. Initial load URL
function loadIframe() {
  log('INIT', 'loadIframe() called');
  chrome.storage.local.get("savedIframeUrl", (data) => {
    if (data.savedIframeUrl) {
      savedUrl = data.savedIframeUrl;
      log('INIT', 'Saved URL found: ' + savedUrl);
      setStatus('loading');
      webview.src = savedUrl;
    } else {
      log('INIT', 'No saved URL found, showing config hint');
      webview.srcdoc = "<h3>Please configure the URL in the extension options first.</h3>";
    }
  });
}

// Initial execution
log('INIT', '=== AOE Side Panel Debug Mode Started ===');
log('INIT', 'User Agent: ' + navigator.userAgent);
log('INIT', 'Timestamp: ' + new Date().toISOString());
loadIframe();

// 1. Refresh button logic (also resets retry count)
refreshBtn.addEventListener('click', () => {
  log('USER', 'Refresh button clicked');
  autoRetryCount = 0;
  reloadIframe();
});

pasteBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const tagsToRemove = [
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CANVAS', 'SVG',
        'HEADER', 'FOOTER', 'NAV', 'TEXTAREA', 'SELECT', 'APPLET', 'MAP'
      ];
      const indentSymbol = "\t"; // Indentation symbol, can be changed to "\t" or "    "

      // 2. Function to check if an element is visible
      const isVisible = (el) => {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               el.offsetWidth > 0 &&
               el.offsetHeight > 0;
      };

      // Recursive processing function
      function processNode(node, depth) {
        // 1. Filter out unwanted tags or invisible elements
        if ((node.nodeType === Node.ELEMENT_NODE && tagsToRemove.includes(node.tagName)) || !isVisible(node)) {
          return [];
        }

        let lines = [];

        // 2. Process direct text child nodes of the current node
        // Extract text belonging directly to the current element to avoid duplication
        let directText = "";
        node.childNodes.forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent.trim();
            if (text) directText += (directText ? " " : "") + text;
          }
        });

        // 3. If the current node has text, apply indentation rules and add to array
        if (directText) {
          // Clean up redundant spaces in text
          const cleanedText = directText.replace(/[ \t]{2,}/g, ' ');
          lines.push(cleanedText);
        }

        // 4. Recursively process child elements (excluding text nodes, handled above)
        node.childNodes.forEach(child => {
          if (child.nodeType === Node.ELEMENT_NODE) {
            lines.push(...processNode(child, depth + 1));
          }
        });

        return lines;
      }

      // Start recursion from body, body defined as depth 0
      const allLines = processNode(document.body, 0);

      // 5. Final merge
      return allLines.join('\n');
    }
  });

  const extractedText = results[0].result;
  // Send to the iframe inside the sidebar

  webview.contentWindow.postMessage({ type: 'EXECUTE_PASTE',contentType: 'text', data: extractedText }, '*');
  
});

// 2. Insert Screen
screenBtn.addEventListener('click', async () => {
  try {
    // capture screen
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    
    // send to iframe
    webview.contentWindow.postMessage({ 
      type: 'EXECUTE_PASTE', 
      contentType: 'image', 
      data: dataUrl 
    }, '*');
  } catch (e) {
    console.error("Screenshot failed", e);
  }
});