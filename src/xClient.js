/**
 * xClient.js
 * Posts tweets via X API v2 using OAuth 1.0a (free write-only tier).
 *
 * Cost: $0/month (free tier, write-only, 1,500 tweets/month limit)
 * We never read tweets — only post. That's all the free tier allows,
 * and all we need.
 *
 * Required env vars:
 *   X_API_KEY            – from X Developer Portal (free app)
 *   X_API_SECRET
 *   X_ACCESS_TOKEN       – your bot account's access token
 *   X_ACCESS_TOKEN_SECRET
 *
 * Rate limiting:
 *   X free tier: ~2 tweets/hour effective limit (1,500/month ÷ 720 hours)
 *   We queue tweets and enforce a minimum gap of 90 seconds between posts
 *   to stay well clear of any hourly limits.
 */

const crypto = require("crypto");

// ─── Config ───────────────────────────────────────────────────────
const DRY_RUN = process.env.DRY_RUN === "true"; // set to skip actual posting
const MIN_GAP_MS = 90_000; // 90 seconds between tweets

let lastTweetTime = 0;
const queue = [];
let processing = false;

// ─── OAuth 1.0a signing ───────────────────────────────────────────
function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

function buildOAuthHeader(method, url, params, credentials) {
  const oauthParams = {
    oauth_consumer_key:     credentials.apiKey,
    oauth_nonce:            crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
    oauth_token:            credentials.accessToken,
    oauth_version:          "1.0",
  };

  // Merge all params for signature base
  const allParams = { ...params, ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessTokenSecret)}`;
  const signature  = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  oauthParams.oauth_signature = signature;

  const headerValue = "OAuth " + Object.keys(oauthParams)
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return headerValue;
}

// ─── Post a single tweet ──────────────────────────────────────────
async function postTweet(text) {
  if (DRY_RUN) {
    console.log("[xClient] DRY RUN tweet:\n" + text + "\n---");
    return { id: "dry-run-" + Date.now() };
  }

  const credentials = {
    apiKey:             process.env.X_API_KEY,
    apiSecret:          process.env.X_API_SECRET,
    accessToken:        process.env.X_ACCESS_TOKEN,
    accessTokenSecret:  process.env.X_ACCESS_TOKEN_SECRET,
  };

  if (!credentials.apiKey) throw new Error("X_API_KEY not set");

  const url  = "https://api.twitter.com/2/tweets";
  const body = JSON.stringify({ text });

  const authHeader = buildOAuthHeader("POST", url, {}, credentials);

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": authHeader,
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    // Handle rate limit gracefully
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("x-rate-limit-reset") ?? "60");
      console.warn(`[xClient] Rate limited. Retry after ${retryAfter}s`);
      throw Object.assign(new Error("rate_limited"), { retryAfter: retryAfter * 1000 });
    }
    throw new Error(`X API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  console.log(`[xClient] Posted tweet ${data.data?.id}: ${text.slice(0, 60)}...`);
  return data.data;
}

// ─── Queue processor (respects 90s gap) ──────────────────────────
async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  while (queue.length > 0) {
    const { text, resolve, reject, priority } = queue[0];

    const now  = Date.now();
    const wait = Math.max(0, lastTweetTime + MIN_GAP_MS - now);

    if (wait > 0) {
      await new Promise(r => setTimeout(r, wait));
    }

    try {
      const result = await postTweet(text);
      lastTweetTime = Date.now();
      queue.shift();
      resolve(result);
    } catch (err) {
      if (err.retryAfter) {
        // Rate limited — back off and retry
        console.warn(`[xClient] Backing off ${err.retryAfter}ms`);
        await new Promise(r => setTimeout(r, err.retryAfter));
        // Don't shift — retry same tweet
      } else {
        queue.shift();
        reject(err);
      }
    }
  }

  processing = false;
}

/**
 * Enqueue a tweet for posting.
 * Returns a promise that resolves when the tweet is posted.
 * Heartbreak tweets are given priority=1 (jump the queue).
 */
function tweet(text, opts = {}) {
  return new Promise((resolve, reject) => {
    const item = { text, resolve, reject, priority: opts.priority ?? 0 };
    if (opts.priority) {
      // Priority tweets (heartbreaks) go to front of queue
      queue.unshift(item);
    } else {
      queue.push(item);
    }
    processQueue();
  });
}

/**
 * Monthly usage tracker — simple in-memory count.
 * Logs a warning at 1,200 tweets (80% of free tier limit).
 */
let monthlyCount = 0;
const MONTH_LIMIT = 1_500;

function trackUsage() {
  monthlyCount++;
  if (monthlyCount === Math.floor(MONTH_LIMIT * 0.8)) {
    console.warn(`[xClient] ⚠️  At 80% of monthly tweet limit (${monthlyCount}/${MONTH_LIMIT}). Monitor usage.`);
  }
  if (monthlyCount >= MONTH_LIMIT) {
    console.error(`[xClient] 🚨 Monthly tweet limit reached (${MONTH_LIMIT}). Tweets paused until next month.`);
    // In production: set a flag and check it in tweet()
  }
}

/**
 * Safe post — wraps tweet() with usage tracking and error handling.
 * This is the main entry point called by the event handler.
 */
async function safePost(text, opts = {}) {
  if (monthlyCount >= MONTH_LIMIT && !DRY_RUN) {
    console.warn("[xClient] Monthly limit reached. Skipping tweet.");
    return null;
  }
  try {
    const result = await tweet(text, opts);
    trackUsage();
    return result;
  } catch (err) {
    console.error("[xClient] Failed to post tweet:", err.message);
    return null;
  }
}

module.exports = { safePost, tweet, queue, getMonthlyCount: () => monthlyCount };
