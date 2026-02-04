(function () {
  // --- KONFIGURATION ---
  const COMMENT_SELECTOR = "button[data-view-name='feed-comment-button']";
  const SHARE_SELECTOR   = "button[data-view-name='feed-share-button']";
  const SEND_SELECTOR    = "button[data-view-name='feed-send-as-message-button']";
  const TEXT_BOX_SELECTOR = 'span[data-testid="expandable-text-box"]';
  
  const POST_MARKER_ATTR = "data-custom-post-processed";
  const SMOOTHING = 10;
  const ACTIVE_COLOR = "#df3333"; // Rot für aktiven Dislike

  let cachedClientId = null;

  // --- UTILS ---
  function generateHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  function parseReactionCount(text) {
    if (!text) return 0;
    text = text.trim().replace(/\u00A0|\u202F/g, '').replace(/\s/g, '').toUpperCase();
    if (text.endsWith('K')) return Math.round(parseFloat(text.replace(',', '.')) * 1000);
    if (text.endsWith('M')) return Math.round(parseFloat(text.replace(',', '.')) * 1_000_000);
    const digitsOnly = text.replace(/[^\d]/g, '');
    return parseInt(digitsOnly, 10) || 0;
  }

  function estimateDisplayedDislikes(rawDislikes, totalReactions) {
    if (totalReactions <= 0) return rawDislikes || 0;
    const ratio = (rawDislikes + SMOOTHING) / (totalReactions + SMOOTHING * 2);
    return Math.max(0, Math.round(ratio * totalReactions));
  }

  async function getClientId() {
    if (cachedClientId) return cachedClientId;
    return new Promise((resolve) => {
      chrome.storage.local.get(['client_id'], (r) => {
        if (r.client_id) {
          cachedClientId = r.client_id;
          resolve(r.client_id);
        } else {
          const id = crypto.randomUUID();
          chrome.storage.local.set({ client_id: id }, () => {
            cachedClientId = id;
            resolve(id);
          });
        }
      });
    });
  }

  // --- UI & AKTIONEN ---
  async function toggleDislike(btn, postHash, currentIsActive) {
    const clientId = await getClientId();
    const action = currentIsActive ? "undislike" : "dislike";
    const counterSpan = btn.querySelector(".dislike-count");
    
    chrome.runtime.sendMessage({ action, post_id: postHash, client_id: clientId }, (response) => {
      if (response && response.success !== false) {
        // UI sofort anpassen
        const newActive = !currentIsActive;
        btn.style.color = newActive ? ACTIVE_COLOR : "#0a66c2";
        btn.style.borderColor = newActive ? ACTIVE_COLOR : "#0a66c2";
        btn.dataset.active = newActive;
        
        // Wert inkrementieren/dekrementieren (lokale Vorschau vor neuem Fetch)
        let currentVal = parseInt(counterSpan.textContent) || 0;
        counterSpan.textContent = newActive ? currentVal + 1 : Math.max(0, currentVal - 1);
      }
    });
  }

  function createDislikeButton(postHash, totalReactions) {
    const btn = document.createElement("button");
    btn.innerHTML = `👎 <span class="dislike-count">...</span>`;
    btn.style.cssText = "margin-left: 8px; padding: 4px 10px; border-radius: 16px; border: 1px solid #0a66c2; background: #ffffff; color: #0a66c2; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s;";
    btn.dataset.active = "false";

    // Initialen Wert laden
    chrome.runtime.sendMessage({ action: "get-dislike-count", post_id: postHash }, (response) => {
      const raw = response?.dislike_count ?? 0;
      const displayValue = estimateDisplayedDislikes(raw, totalReactions);
      btn.querySelector(".dislike-count").textContent = displayValue;
    });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isActive = btn.dataset.active === "true";
      toggleDislike(btn, postHash, isActive);
    });

    return btn;
  }

  // --- PROZESSIERUNG ---
  function findReactionCount(startElement) {
    let el = startElement;
    let levels = 0;
    const NUMBER_REGEX = /^\d{1,3}([.,]\d{3})*$/;
    while (el && levels < 8) {
      const spans = el.querySelectorAll("span");
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text && span.offsetParent !== null && NUMBER_REGEX.test(text)) return parseReactionCount(text);
      }
      el = el.parentElement;
      levels++;
    }
    return 0;
  }

  function processFeed() {
    const textElements = document.querySelectorAll(TEXT_BOX_SELECTOR);
    const contents = Array.from(textElements).map(el => el.textContent.trim());
    const commentButtons = document.querySelectorAll(COMMENT_SELECTOR);

    commentButtons.forEach((commentBtn, index) => {
      const buttonContainer = commentBtn.parentElement;
      if (!buttonContainer || buttonContainer.hasAttribute(POST_MARKER_ATTR)) return;

      const shareBtn = buttonContainer.querySelector(SHARE_SELECTOR);
      const sendBtn  = buttonContainer.querySelector(SEND_SELECTOR);

      if (shareBtn && sendBtn) {
        buttonContainer.setAttribute(POST_MARKER_ATTR, "true");

        const fullText = contents[index] || "";
        const postHash = fullText ? generateHash(fullText) : null;
        if (!postHash) return;

        const totalReactions = findReactionCount(buttonContainer);
        const dislikeBtn = createDislikeButton(postHash, totalReactions);
        buttonContainer.appendChild(dislikeBtn);
      }
    });
  }

  // Start
  processFeed();
  new MutationObserver(processFeed).observe(document.body, { childList: true, subtree: true });
})();