/**
 * mlbPoller.js
 * Polls MLB Stats API (free, no key) for live games.
 * Detects rare events and emits them to the event bus.
 *
 * Key endpoints used:
 *   /api/v1/schedule          – today's game IDs
 *   /api/v1.1/game/{id}/feed/live – full live play-by-play
 */

const EventEmitter = require("events");

const BASE = "https://statsapi.mlb.com";

// ─── Polling intervals (ms) ──────────────────────────────────────
const INTERVALS = {
  STANDARD: 30_000,  // inn 1–6
  ELEVATED: 10_000,  // inn 7+  (any active slow-burn event)
};

// ─── State per game ───────────────────────────────────────────────
// gameState[gamePk] = {
//   tier, outsRecorded, activeEvents: Set, brokenEvents: Set,
//   lastPlayIndex, hitsAllowed, runsAllowed, walksAllowed,
//   strikeoutsToday, cycleBatter, cycleHits: Set,
//   tweetedOuts: Set  (which out counts we've already tweeted)
// }
const gameState = {};

const bus = new EventEmitter();
bus.setMaxListeners(50);

// ─── Fetch helpers ────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "DontJinxIt-Bot/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function getTodayGameIds() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const data  = await fetchJSON(`${BASE}/api/v1/schedule?sportId=1&date=${today}&gameType=R`);
  const ids   = [];
  for (const date of data.dates ?? []) {
    for (const game of date.games ?? []) {
      // Only poll games that are live or recently final
      if (["I", "IR", "IO", "MA"].includes(game.status?.abstractGameCode ?? "")) {
        ids.push(game.gamePk);
      }
    }
  }
  return ids;
}

// ─── Event detection logic ────────────────────────────────────────
function detectEvents(gamePk, feed) {
  const liveData   = feed.liveData;
  const gameData   = feed.gameData;
  const plays      = liveData?.plays?.allPlays ?? [];
  const linescore  = liveData?.linescore ?? {};
  const boxscore   = liveData?.boxscore ?? {};

  const inning     = linescore.currentInning ?? 1;
  const half       = linescore.inningHalf ?? "Top";  // "Top" | "Bottom"
  const outsInGame = (inning - 1) * 3 + (linescore.outs ?? 0) + (half === "Bottom" ? 0 : 0);
  // More precise: count total outs from play log
  const totalOuts  = plays.filter(p => p.about?.isComplete).reduce((acc, p) => acc + (p.count?.outs ?? 0), 0);

  const state = gameState[gamePk];
  const prevOuts = state.outsRecorded;

  // Update rolling stats from boxscore
  const homePitching = boxscore?.teams?.home?.pitching ?? {};
  const awayPitching = boxscore?.teams?.away?.pitching ?? {};
  // We care about whichever team is pitching (home when away bats, etc.)
  // Simplified: track hits/runs/walks against the pitching team
  state.hitsAllowed   = (homePitching.hits   ?? 0) + (awayPitching.hits   ?? 0);
  state.runsAllowed   = (homePitching.runs   ?? 0) + (awayPitching.runs   ?? 0);
  state.walksAllowed  = (homePitching.baseOnBalls ?? 0) + (awayPitching.baseOnBalls ?? 0);
  state.strikeoutsToday = Math.max(homePitching.strikeOuts ?? 0, awayPitching.strikeOuts ?? 0);
  state.outsRecorded  = totalOuts;
  state.inning        = inning;
  state.half          = half;

  const newOuts = totalOuts - prevOuts;
  if (newOuts <= 0 && state.outsRecorded === prevOuts) return; // nothing changed

  const events = [];

  // ── PERFECT GAME ─────────────────────────────────────────────
  if (!state.brokenEvents.has("perfect_game")) {
    const perfect = state.hitsAllowed === 0 && state.walksAllowed === 0 && state.runsAllowed === 0 && state.outsRecorded > 0;
    if (perfect && state.outsRecorded >= 18) {  // inn 7+
      if (!state.activeEvents.has("perfect_game")) state.activeEvents.add("perfect_game");
      events.push({ type: "perfect_game", outsRecorded: state.outsRecorded, inning });
    } else if (state.activeEvents.has("perfect_game") && !perfect) {
      state.activeEvents.delete("perfect_game");
      state.brokenEvents.add("perfect_game");
      events.push({ type: "perfect_game_broken", inning, outsRecorded: state.outsRecorded });
    }
  }

  // ── NO-HITTER ─────────────────────────────────────────────────
  if (!state.brokenEvents.has("no_hitter")) {
    const noHit = state.hitsAllowed === 0 && state.outsRecorded > 0;
    if (noHit && state.outsRecorded >= 18) {
      if (!state.activeEvents.has("no_hitter")) state.activeEvents.add("no_hitter");
      events.push({ type: "no_hitter", outsRecorded: state.outsRecorded, inning });
    } else if (state.activeEvents.has("no_hitter") && !noHit) {
      state.activeEvents.delete("no_hitter");
      state.brokenEvents.add("no_hitter");
      events.push({ type: "no_hitter_broken", inning, outsRecorded: state.outsRecorded });
    }
  }

  // ── SHUTOUT ───────────────────────────────────────────────────
  if (!state.brokenEvents.has("shutout")) {
    const shutout = state.runsAllowed === 0 && state.outsRecorded > 0;
    if (shutout && state.outsRecorded >= 21) {  // inn 8+
      if (!state.activeEvents.has("shutout")) state.activeEvents.add("shutout");
      events.push({ type: "shutout", outsRecorded: state.outsRecorded, inning });
    } else if (state.activeEvents.has("shutout") && !shutout) {
      state.activeEvents.delete("shutout");
      state.brokenEvents.add("shutout");
      events.push({ type: "shutout_broken", inning, outsRecorded: state.outsRecorded });
    }
  }

  // ── 20-STRIKEOUT GAME ─────────────────────────────────────────
  if (state.strikeoutsToday >= 15 && !state.brokenEvents.has("k_game")) {
    if (!state.activeEvents.has("k_game")) state.activeEvents.add("k_game");
    events.push({ type: "k_game", strikeouts: state.strikeoutsToday, outsRecorded: state.outsRecorded });
    if (state.strikeoutsToday >= 20) {
      events.push({ type: "k_game_achieved", strikeouts: state.strikeoutsToday });
      state.brokenEvents.add("k_game"); // fire once
    }
  }

  // ── INSTANT EVENTS (scan new plays since last index) ─────────
  const newPlays = plays.slice(state.lastPlayIndex);
  state.lastPlayIndex = plays.length;

  for (const play of newPlays) {
    const result = play.result?.eventType ?? "";
    const desc   = (play.result?.description ?? "").toLowerCase();

    // Triple play
    if (result === "triple_play") {
      events.push({ type: "triple_play", play });
    }

    // Unassisted triple play — description contains "unassisted"
    if (result === "triple_play" && desc.includes("unassisted")) {
      events.push({ type: "unassisted_tp", play });
    }

    // Immaculate inning — detect from pitcher's inning pitches
    // Approximation: 3 strikeouts in an inning with pitchIndex <= 9
    // The full check would need pitch-level data; flag for manual review
    if (result === "strikeout") {
      const inn     = play.about?.inning;
      const halfStr = play.about?.halfInning; // "top" | "bottom"
      const key     = `${inn}-${halfStr}`;
      if (!state.innKs) state.innKs = {};
      if (!state.innPitches) state.innPitches = {};
      state.innKs[key] = (state.innKs[key] ?? 0) + 1;
      // Count pitches: each play has pitchIndex entries
      const pitchCount = (play.pitchIndex ?? []).length;
      state.innPitches[key] = (state.innPitches[key] ?? 0) + pitchCount;
      if (state.innKs[key] === 3 && state.innPitches[key] <= 9) {
        events.push({ type: "immaculate_inning", play });
      }
    }

    // Inside-the-park HR
    if (result === "home_run" && desc.includes("inside-the-park")) {
      events.push({ type: "inside_park_hr", play });
    }

    // Walk-off grand slam — grand slam + walk-off flag
    if (result === "home_run" && play.about?.isWalkOff && desc.includes("grand slam")) {
      events.push({ type: "walkoff_grand_slam", play });
    }

    // 4 HR by same batter
    const batterId = play.matchup?.batter?.id;
    if (result === "home_run" && batterId) {
      if (!state.hrCounts) state.hrCounts = {};
      state.hrCounts[batterId] = (state.hrCounts[batterId] ?? 0) + 1;
      if (state.hrCounts[batterId] === 4) {
        events.push({ type: "four_hr", play, batterId });
      }
    }

    // Cycle tracking
    if (batterId) {
      if (!state.cycleHits) state.cycleHits = {};
      if (!state.cycleHits[batterId]) state.cycleHits[batterId] = new Set();
      const hitMap = { single: "1B", double: "2B", triple: "3B", home_run: "HR" };
      if (hitMap[result]) {
        state.cycleHits[batterId].add(hitMap[result]);
        const hits = state.cycleHits[batterId];
        // Alert when 3 of 4 hit types achieved
        if (hits.size === 3 && state.outsRecorded >= 9) {
          const missing = ["1B","2B","3B","HR"].find(h => !hits.has(h));
          events.push({ type: "cycle", play, batterId, cycleHits: [...hits], cycleNeeds: missing });
        }
        // Cycle complete
        if (hits.size === 4 && !state.brokenEvents.has(`cycle_${batterId}`)) {
          events.push({ type: "cycle_complete", play, batterId });
          state.brokenEvents.add(`cycle_${batterId}`);
        }
      }
    }
  }

  return { events, state };
}

// ─── Per-game poll loop ───────────────────────────────────────────
async function pollGame(gamePk, gameInfo) {
  try {
    const feed = await fetchJSON(`${BASE}/api/v1.1/game/${gamePk}/feed/live`);
    const abstractState = feed.gameData?.status?.abstractGameState;

    // Game over — clean up
    if (abstractState === "Final") {
      bus.emit("game_final", { gamePk, gameInfo });
      return "final";
    }

    const { events, state } = detectEvents(gamePk, feed);

    // Determine tier (ELEVATED if inning 7+ and any active slow-burn)
    const slowBurns    = ["perfect_game","no_hitter","shutout","k_game","cycle"];
    const hasSlowBurn  = slowBurns.some(e => state.activeEvents.has(e));
    const newTier      = (state.inning >= 7 && hasSlowBurn) ? "ELEVATED" : "STANDARD";

    if (newTier !== state.tier) {
      state.tier = newTier;
      bus.emit("tier_change", { gamePk, tier: newTier, state });
    }

    // Emit events — but only for outs we haven't already tweeted
    for (const ev of events) {
      const isSlowBurn = ["perfect_game","no_hitter","shutout","k_game","cycle"].includes(ev.type);
      if (isSlowBurn) {
        const outKey = `${ev.type}-${ev.outsRecorded}`;
        if (state.tweetedOuts.has(outKey)) continue; // dedupe
        state.tweetedOuts.add(outKey);
      }
      bus.emit("rare_event", { gamePk, gameInfo, event: ev, state, feed });
    }

    return newTier;

  } catch (err) {
    console.error(`[poll] game ${gamePk} error:`, err.message);
    return "error";
  }
}

// ─── Main scheduler ───────────────────────────────────────────────
async function startPolling() {
  console.log("[mlbPoller] Starting...");

  // Poll game list every 5 min to pick up new games
  async function refreshGames() {
    try {
      const ids = await getTodayGameIds();
      for (const gamePk of ids) {
        if (!gameState[gamePk]) {
          // Fetch game metadata for tweet context
          const sched = await fetchJSON(`${BASE}/api/v1/game/${gamePk}/boxscore`);
          const teams = sched.teams ?? {};
          gameState[gamePk] = {
            tier: "STANDARD",
            outsRecorded: 0,
            inning: 1,
            half: "Top",
            activeEvents: new Set(),
            brokenEvents: new Set(),
            tweetedOuts: new Set(),
            lastPlayIndex: 0,
            hitsAllowed: 0,
            runsAllowed: 0,
            walksAllowed: 0,
            strikeoutsToday: 0,
            hrCounts: {},
            cycleHits: {},
            innKs: {},
            innPitches: {},
            // Team info for tweet generation
            awayTeam: teams.away?.team?.name ?? "Away",
            awayAbbr: teams.away?.team?.abbreviation ?? "AWY",
            homeTeam: teams.home?.team?.name ?? "Home",
            homeAbbr: teams.home?.team?.abbreviation ?? "HME",
          };
          console.log(`[mlbPoller] Tracking game ${gamePk}: ${gameState[gamePk].awayAbbr} @ ${gameState[gamePk].homeAbbr}`);
          bus.emit("game_added", { gamePk, gameInfo: gameState[gamePk] });
        }
      }
    } catch (err) {
      console.error("[mlbPoller] refreshGames error:", err.message);
    }
  }

  await refreshGames();
  setInterval(refreshGames, 5 * 60_000);

  // Per-game adaptive polling
  async function tickGames() {
    for (const [gamePk, state] of Object.entries(gameState)) {
      // Determine interval based on current tier
      const interval = state.tier === "ELEVATED" ? INTERVALS.ELEVATED : INTERVALS.STANDARD;
      const now      = Date.now();
      if (!state._lastPoll || now - state._lastPoll >= interval) {
        state._lastPoll = now;
        const result = await pollGame(parseInt(gamePk), state);
        if (result === "final") {
          delete gameState[gamePk];
        }
      }
    }
  }

  // Fast tick (5s) — each game self-throttles by its own interval
  setInterval(tickGames, 5_000);
  tickGames(); // immediate first run
}

module.exports = { bus, startPolling, gameState };
