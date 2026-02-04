(function () {
  console.log('AOE Content Script Loaded Successfully');

  let OriginalFile = window.File;
  let textToUse = "";
  let isAskAi = false;

  // Replace File constructor for text injection
  window.File = function (bits, name, options) {
    if (typeof name === 'string' && name.startsWith('Pasted_Text_') && isAskAi) {
      isAskAi = false;
      const cleanBlob = new Blob([textToUse], { type: 'text/plain' });
      return new OriginalFile([cleanBlob], name, options);
    }
    return new OriginalFile(bits, name, options);
  };

  // Convert data URL to file
  async function dataURLtoFile(dataurl, filename) {
    try {
      const res = await fetch(dataurl);
      const blob = await res.blob();
      return new OriginalFile([blob], filename, { type: 'image/png' });
    } catch (error) {
      console.error('Failed to convert data URL to file:', error);
      throw error;
    }
  }

  // Listen for paste events from content-bridge.js
  window.addEventListener('START_PASTE_PROCESS', async (e) => {
    try {
      console.log('Received paste event:', e.detail);

      const { contentType, data } = e.detail;

      // Find chat input element with multiple fallback selectors
      const el = document.querySelector('#chat-input[contenteditable="true"]') ||
        document.querySelector('#chat-input') ||
        document.querySelector('.tiptap.ProseMirror[contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"].tiptap') ||
        document.querySelector('[contenteditable="true"]');

      if (!el) {
        console.error('Chat input element not found');
        return;
      }

      console.log('Found chat input element:', el.tagName, el.className, el.id);

      if (contentType === 'text') {
        // Handle text insertion for contenteditable elements
        el.focus();
        el.textContent = data;

        // Trigger input and change events
        const inputEvent = new Event('input', { bubbles: true });
        const changeEvent = new Event('change', { bubbles: true });
        el.dispatchEvent(inputEvent);
        el.dispatchEvent(changeEvent);

        console.log('Text inserted into contenteditable element');

      } else if (contentType === 'image') {
        // Handle image insertion
        try {
          // Method 1: Direct HTML insertion
          el.focus();

          const img = document.createElement('img');
          img.src = data;
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          img.alt = 'Screenshot';

          // Insert at cursor position
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(img);

            // Move cursor after image
            range.setStartAfter(img);
            range.setEndAfter(img);
            selection.removeAllRanges();
            selection.addRange(range);
          } else {
            el.appendChild(img);
          }

          const inputEvent = new Event('input', { bubbles: true });
          el.dispatchEvent(inputEvent);

          console.log('Image inserted via HTML method');

        } catch (htmlError) {
          console.log('HTML method failed, trying file upload:', htmlError);

          // Fallback: File upload method
          try {
            const imageFile = await dataURLtoFile(data, `screenshot_${Date.now()}.png`);
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(imageFile);

            const pasteEvent = new ClipboardEvent('paste', {
              clipboardData: dataTransfer,
              bubbles: true,
              cancelable: true,
              composed: true
            });

            el.dispatchEvent(pasteEvent);
            console.log('Image inserted via paste method');

          } catch (fallbackError) {
            console.error('Both image insertion methods failed:', fallbackError);
          }
        }
      }

    } catch (error) {
      console.error('Error in paste process:', error);
    }
  });

  console.log('AOE Content Script initialization complete');
})();