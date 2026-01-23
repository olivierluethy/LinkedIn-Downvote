// === LinkedIn Dislike Extension – content.js ===
// Optimized RYD-style dislike estimation (DISPLAY ONLY)

const processedPosts = new WeakSet();
const SMOOTHING = 20;
const ACTIVE_COLOR = "#0a66c2";

// =========================
// GLOBAL CACHES
// =========================
let cachedClientId = null;
let votedCache = null;
let isProcessing = false;

// =========================
// UTILS
// =========================
function parseReactionCount(text) {
  if (!text) return 0;

  text = text
    .trim()
    .replace(/\u00A0|\u202F/g, '')
    .replace(/\s/g, '')
    .toUpperCase();

  if (text.endsWith('K')) {
    return Math.round(parseFloat(text.replace(',', '.')) * 1000);
  }

  if (text.endsWith('M')) {
    return Math.round(parseFloat(text.replace(',', '.')) * 1_000_000);
  }

  const digitsOnly = text.replace(/[^\d]/g, '');
  return parseInt(digitsOnly, 10) || 0;
}

function estimateDisplayedDislikes(rawDislikes, totalReactions) {
  if (totalReactions <= 0) return 0;
  const ratio =
    (rawDislikes + SMOOTHING) /
    (totalReactions + SMOOTHING * 2);
  return Math.max(0, Math.round(ratio * totalReactions));
}

// =========================
// POST ID (CACHED IN DOM)
// =========================
function extractPostId(post) {
  if (post.dataset.postId) return post.dataset.postId;

  const urnRegex = /urn:li:(?:activity|share):(\d+)/i;
  let current = post;

  while (current && current !== document.body) {
    if (current.dataset?.urn) {
      const m = current.dataset.urn.match(urnRegex);
      if (m) return (post.dataset.postId = m[1]);
    }
    current = current.parentElement;
  }

  const link = post.querySelector('a[href*="/activity/"], a[href*="/posts/"]');
  if (link?.href) {
    const m = link.href.match(/activity[/-](\d+)/i);
    if (m) return (post.dataset.postId = m[1]);
  }

  const temp =
    `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  post.dataset.postId = temp;
  return temp;
}

// =========================
// CLIENT ID (ONCE)
// =========================
async function getClientId() {
  if (cachedClientId) return cachedClientId;

  return new Promise((resolve) => {
    chrome.storage.local.get(['client_id'], (r) => {
      if (r.client_id) {
        cachedClientId = r.client_id;
        return resolve(r.client_id);
      }
      const id = crypto.randomUUID();
      chrome.storage.local.set({ client_id: id }, () => {
        cachedClientId = id;
        resolve(id);
      });
    });
  });
}

// =========================
// VOTED POSTS (MEMORY CACHE)
// =========================
async function getVotedPosts() {
  if (votedCache) return votedCache;

  return new Promise((resolve) => {
    chrome.storage.local.get(['linkdown-voted'], (r) => {
      votedCache = r['linkdown-voted'] || [];
      resolve(votedCache);
    });
  });
}

async function setPostVoted(postId, voted) {
  const list = await getVotedPosts();
  const has = list.includes(postId);

  if (voted && !has) list.push(postId);
  else if (!voted && has)
    votedCache = list.filter(id => id !== postId);
  else return;

  await chrome.storage.local.set({ 'linkdown-voted': votedCache });
}

// =========================
// UI HELPERS
// =========================
function applyDownvoteStyle(btn, active) {
  btn.style.color = active ? ACTIVE_COLOR : "";
  btn.style.fontWeight = active ? "600" : "";
  btn.setAttribute("aria-pressed", active ? "true" : "false");
}

// =========================
// SERVER → DISPLAY LOGIC
// =========================
function updateDislikeCount(post, postId, counter) {
  if (!counter || !counter.isConnected) return;

  chrome.runtime.sendMessage(
    { action: "get-dislike-count", post_id: postId },
    (response) => {
      const raw = response?.dislike_count ?? 0;

      if (!post.dataset.totalReactions) {
        const span = post.querySelector(
          "span.social-details-social-counts__reactions-count"
        );
        post.dataset.totalReactions =
          parseReactionCount(span?.innerText);
      }

      const total = Number(post.dataset.totalReactions) || 0;
      counter.textContent =
        estimateDisplayedDislikes(raw, total);
      counter.dataset.raw = raw;
    }
  );
}

// =========================
// MAIN PROCESSOR
// =========================
async function processPosts() {
  const COMMENT_SELECTOR = "button[data-view-name='feed-comment-button']";
  const SHARE_SELECTOR   = "button[data-view-name='feed-share-button']";
  const SEND_SELECTOR    = "button[data-view-name='feed-send-as-message-button']";

  const POST_MARKER_ATTR = "data-custom-post-processed";

  function createCustomButton() {
    const btn = document.createElement("button");
    btn.innerText = "Custom";
    btn.style.marginLeft = "8px";
    btn.style.padding = "4px 10px";
    btn.style.borderRadius = "16px";
    btn.style.border = "1px solid #0a66c2";
    btn.style.background = "#ffffff";
    btn.style.color = "#0a66c2";
    btn.style.cursor = "pointer";
    btn.style.fontSize = "12px";

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      alert("Custom Button clicked");
    });

    return btn;
  }

  function processFeed() {
    const commentButtons = document.querySelectorAll(COMMENT_SELECTOR);

    commentButtons.forEach(commentBtn => {
      // Button-Container (meist die Action-Leiste des Posts)
      const buttonContainer = commentBtn.parentElement;
      if (!buttonContainer) return;

      // Bereits verarbeitet?
      if (buttonContainer.hasAttribute(POST_MARKER_ATTR)) return;

      const shareBtn = buttonContainer.querySelector(SHARE_SELECTOR);
      const sendBtn  = buttonContainer.querySelector(SEND_SELECTOR);

      // Nur wenn alle drei Buttons vorhanden sind → gültiger Post
      if (!shareBtn || !sendBtn) return;

      // Markieren, damit wir ihn nicht doppelt verarbeiten
      buttonContainer.setAttribute(POST_MARKER_ATTR, "true");

      // Custom Button einfügen
      const customButton = createCustomButton();
      buttonContainer.appendChild(customButton);
    });
  }

  // Initialer Lauf
  processFeed();

  // Beobachter für dynamisches Nachladen
  const observer = new MutationObserver(() => {
    processFeed();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// =========================
// OBSERVER (NO SCROLL HACK)
// =========================
const observer = new MutationObserver(() => {
  processPosts().catch(console.error);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Initial run
processPosts().catch(console.error);
