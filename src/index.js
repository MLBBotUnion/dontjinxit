/**
 * index.js
 * Entry point. Wires the MLB poller → MC engine → tweet composer → X client.
 *
 * This is the only file that needs to run on the server.
 * It works as a plain Node.js process — no framework, no DB, no cloud services.
 *
 * Deploy target: Render.com free tier (always-on background worker)
 * Cost: $0/month (free tier is sufficient for a background worker running
 *        during MLB season hours only)
 */

require("dotenv").config();

const { bus, startPolling } = require("./mlbPoller");
const { getProb }           = require("./monteCarlo");
const { compose }           = require("./tweetComposer");
const { safePost, getMonthlyCount } = require("./xClient");

// ─── Tier labels (mirrors dashboard logic) ────────────────────────
function getTierLabel(gs) {
  if (!gs.activeEvents || gs.activeEvents.size === 0) return "STANDARD";
  const outsRecorded = gs.outsRecorded;
  if (outsRecorded >= 26) return "IMMINENT";
  if (gs.inning >= 9 && outsRecorded >= 24) return "CRITICAL";
  if (gs.inning >= 7) return "ELEVATED";
  return "STANDARD";
}

// ─── In-memory tweet log (for diagnostics) ────────────────────────
const tweetLog = [];

function logTweet(gamePk, eventType, text, tier) {
  const entry = {
    ts:        new Date().toISOString(),
    gamePk,
    eventType,
    tier,
    text,
    monthly:   getMonthlyCount(),
  };
  tweetLog.push(entry);
  if (tweetLog.length > 200) tweetLog.shift(); // keep last 200
  console.log(`[handler] Tweeted [${tier}] ${eventType} for game ${gamePk}`);
}

// ─── Core event handler ───────────────────────────────────────────
bus.on("rare_event", async ({ gamePk, gameInfo, event, state, feed }) => {
  try {
    const tier = getTierLabel(state);

    // Get MC probability for slow-burn events
    let prob = null;
    const slowBurns = ["perfect_game","no_hitter","combined_no_hitter","shutout","k_game","cycle"];
    if (slowBurns.includes(event.type)) {
      prob = getProb(gamePk, event.type, {
        outsRecorded:    state.outsRecorded,
        pitcherKRate:    state.pitcherKRate   ?? 0.24,
        pitcherBBRate:   state.pitcherBBRate  ?? 0.08,
        pitcherWHIP:     state.pitcherWHIP    ?? 1.20,
        oppOBP:          state.oppOBP         ?? 0.320,
        parkFactor:      state.parkFactor     ?? 1.00,
        strikeoutsToday: state.strikeoutsToday ?? 0,
        cycleNeeds:      event.cycleNeeds,
      });
    }

    // Enrich game info with live scores from feed
    const linescore = feed?.liveData?.linescore ?? {};
    const enriched  = {
      ...gameInfo,
      awayScore: linescore.teams?.away?.runs ?? 0,
      homeScore: linescore.teams?.home?.runs ?? 0,
      // Pitcher info from boxscore
      pitcher:       getPitcher(feed, gameInfo),
      pitcherHandle: null, // would need a separate lookup table
    };

    const text = compose(event, enriched, state, tier, prob);
    if (!text) return;

    // Heartbreak tweets get priority — jump the queue
    const isHeartbreak = event.type.endsWith("_broken");
    await safePost(text, { priority: isHeartbreak ? 1 : 0 });
    logTweet(gamePk, event.type, text, tier);

  } catch (err) {
    console.error(`[handler] Error handling event ${event.type}:`, err.message);
  }
});

// ─── Tier change notifications (console only) ─────────────────────
bus.on("tier_change", ({ gamePk, tier, state }) => {
  console.log(`[handler] Game ${gamePk} escalated to ${tier} (inn ${state.inning}, ${state.outsRecorded} outs)`);
});

bus.on("game_added", ({ gamePk, gameInfo }) => {
  console.log(`[handler] Tracking: ${gameInfo.awayAbbr} @ ${gameInfo.homeAbbr} (${gamePk})`);
});

bus.on("game_final", ({ gamePk }) => {
  console.log(`[handler] Game ${gamePk} final.`);
});

// ─── Pitcher extraction helper ────────────────────────────────────
function getPitcher(feed, gameInfo) {
  try {
    const boxscore = feed?.liveData?.boxscore;
    // Find the pitcher currently active on the field
    // Pitchers are in the defense array for each team
    const homePitchers = boxscore?.teams?.home?.pitchers ?? [];
    const awayPitchers = boxscore?.teams?.away?.pitchers ?? [];
    // Current pitcher is last in the array
    const players = feed?.gameData?.players ?? {};
    const currentId = homePitchers[homePitchers.length - 1]
      ?? awayPitchers[awayPitchers.length - 1];
    if (currentId && players[`ID${currentId}`]) {
      return players[`ID${currentId}`].fullName;
    }
  } catch {}
  return gameInfo.pitcher ?? "the pitcher";
}

// ─── Diagnostic HTTP server (optional — Render needs a port to bind) ─
// Render's free tier expects something on $PORT, otherwise it marks the
// service as crashed. We expose a minimal status endpoint.
const http = require("http");
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }
  if (req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      monthlyTweets: getMonthlyCount(),
      recentLog:     tweetLog.slice(-20),
      uptime:        process.uptime(),
    }, null, 2));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`[handler] Status server on :${PORT}`);
});

// ─── Boot ─────────────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════╗
║   @DontJinxIt  — MLB Bot v1.0   ║
║   MLB API: free (no key)         ║
║   X API:   free tier ($0/mo)     ║
║   Host:    Render free tier      ║
╚══════════════════════════════════╝
DRY_RUN = ${process.env.DRY_RUN ?? "false"}
`);

startPolling().catch(err => {
  console.error("[boot] Fatal:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[handler] Shutting down...");
  server.close(() => process.exit(0));
});
