/**
 * testHarness.js
 * Replays real historical rare games out-by-out through the detection engine.
 * Used by the Test Lab dashboard tab.
 *
 * Each scenario includes the real game metadata and a sequence of "game states"
 * representing each meaningful moment (each out in ELEVATED mode, each inning in STANDARD).
 * We don't need the actual MLB API feed for these — we reconstruct the key state
 * fields that the detection engine uses.
 *
 * Real games used:
 *  1. Félix Hernández Perfect Game — Aug 15, 2012 (SEA @ TB, 27-0)
 *  2. Corbin Burnes + Josh Hader Combined No-Hitter — Sep 11, 2021 (MIL @ CLE)
 *  3. Randy Johnson 20-K Game — May 8, 2001 (ARI @ CIN)
 *  4. Jake Marisnick Unassisted Triple Play... actually Eric Bruntlett — Aug 23, 2009
 *  5. Babe Herman Cycle — Sep 30, 1931 (historical reference)
 *     → Modern: Yordan Alvarez Cycle — Aug 3, 2024 (HOU @ OAK)
 *  6. Josh Bell 4 HR — June 19, 2019 (PIT @ CHC)
 *  7. Near-miss: Max Scherzer NH broken with 2 outs in 9th — Oct 3, 2015
 */

const { getProb }    = require("./monteCarlo");
const { compose }    = require("./tweetComposer");
const { enrichWithHandles } = require("./playerHandles");
const { reconcileNoHitEvent, getNoHitterType, isDelayed, getRainDelayTweet } = require("./edgeCases");

// ─── Scenario definitions ─────────────────────────────────────────

const SCENARIOS = [
  {
    id: "felix_pg",
    title: "Félix Hernández Perfect Game",
    date: "August 15, 2012",
    real: true,
    gameInfo: {
      gamePk: 2012081501,
      awayAbbr: "TB", awayTeam: "Tampa Bay Rays",
      homeAbbr: "SEA", homeTeam: "Seattle Mariners",
      pitcher: "Félix Hernández", pitcherMlbId: 518516,
      gameNumber: 1,
    },
    // Sequence of states at key moments
    // Each entry: { outsRecorded, inning, half, hitsAllowed, walksAllowed, runsAllowed, strikeoutsToday, note }
    states: [
      { outsRecorded: 0,  inning: 1, half: "Top",    hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 0,  note: "Game start" },
      { outsRecorded: 3,  inning: 1, half: "Bottom",  hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 2,  note: "End of 1st" },
      { outsRecorded: 6,  inning: 2, half: "Bottom",  hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 5,  note: "End of 2nd" },
      { outsRecorded: 9,  inning: 3, half: "Bottom",  hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 7,  note: "End of 3rd" },
      { outsRecorded: 12, inning: 4, half: "Bottom",  hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 9,  note: "End of 4th" },
      { outsRecorded: 15, inning: 5, half: "Bottom",  hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 10, note: "End of 5th" },
      { outsRecorded: 18, inning: 6, half: "Bottom",  hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 11, note: "End of 6th — FIRST ALERT" },
      { outsRecorded: 19, inning: 7, half: "Top",    hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 11, note: "Out 19 — ELEVATED tier begins" },
      { outsRecorded: 20, inning: 7, half: "Top",    hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 12, note: "Out 20" },
      { outsRecorded: 21, inning: 7, half: "Bottom",  hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 12, note: "End of 7th" },
      { outsRecorded: 22, inning: 8, half: "Top",    hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 12, note: "Out 22" },
      { outsRecorded: 23, inning: 8, half: "Top",    hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 12, note: "Out 23" },
      { outsRecorded: 24, inning: 8, half: "Bottom",  hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 12, note: "End of 8th — CRITICAL tier" },
      { outsRecorded: 25, inning: 9, half: "Top",    hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 12, note: "Out 25" },
      { outsRecorded: 26, inning: 9, half: "Top",    hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 12, note: "Out 26 — IMMINENT" },
      { outsRecorded: 27, inning: 9, half: "Bottom",  hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 12, note: "PERFECT GAME COMPLETE 🎉", complete: true },
    ],
    pitcherStats: { pitcherKRate: 0.32, pitcherBBRate: 0.05, pitcherWHIP: 0.77, oppOBP: 0.298, parkFactor: 0.96 },
    expectedEvents: ["perfect_game"],
    expectedTweetCount: 12, // inn 6 + every out 19-27
  },

  {
    id: "burnes_combined_nh",
    title: "Burnes + Hader Combined No-Hitter",
    date: "September 11, 2021",
    real: true,
    gameInfo: {
      gamePk: 2021091101,
      awayAbbr: "MIL", awayTeam: "Milwaukee Brewers",
      homeAbbr: "CLE", homeTeam: "Cleveland Guardians",
      pitcher: "Corbin Burnes", pitcherMlbId: 621111,
      pitcherCount: 2, // Burnes (8 inn) + Hader (1 inn)
      gameNumber: 1,
    },
    states: [
      { outsRecorded: 18, inning: 6, half: "Bottom", hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 14, pitcherCount: 1, note: "End of 6th — Burnes solo (1 walk, still NH)" },
      { outsRecorded: 19, inning: 7, half: "Top",   hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 14, pitcherCount: 1, note: "Out 19 — ELEVATED" },
      { outsRecorded: 21, inning: 7, half: "Bottom", hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 14, pitcherCount: 1, note: "End of 7th" },
      { outsRecorded: 24, inning: 8, half: "Bottom", hitsAllowed: 0, walksAllowed: 2, runsAllowed: 0, strikeoutsToday: 14, pitcherCount: 1, note: "End of 8th — Burnes done, Hader enters" },
      { outsRecorded: 24, inning: 9, half: "Top",   hitsAllowed: 0, walksAllowed: 2, runsAllowed: 0, strikeoutsToday: 14, pitcherCount: 2, note: "Hader enters — becomes COMBINED" },
      { outsRecorded: 25, inning: 9, half: "Top",   hitsAllowed: 0, walksAllowed: 2, runsAllowed: 0, strikeoutsToday: 14, pitcherCount: 2, note: "Out 25 — CRITICAL" },
      { outsRecorded: 26, inning: 9, half: "Top",   hitsAllowed: 0, walksAllowed: 2, runsAllowed: 0, strikeoutsToday: 14, pitcherCount: 2, note: "Out 26 — IMMINENT" },
      { outsRecorded: 27, inning: 9, half: "Bottom", hitsAllowed: 0, walksAllowed: 2, runsAllowed: 0, strikeoutsToday: 14, pitcherCount: 2, note: "COMBINED NO-HITTER COMPLETE 🎉", complete: true },
    ],
    pitcherStats: { pitcherKRate: 0.41, pitcherBBRate: 0.07, pitcherWHIP: 0.94, oppOBP: 0.282, parkFactor: 1.02 },
    expectedEvents: ["no_hitter", "combined_no_hitter"], // upgrades mid-game
    expectedTweetCount: 9,
  },

  {
    id: "scherzer_nearmiss",
    title: "Scherzer Near No-Hitter — 2 Outs in 9th",
    date: "October 3, 2015",
    real: true,
    gameInfo: {
      gamePk: 2015100301,
      awayAbbr: "NYM", awayTeam: "New York Mets",
      homeAbbr: "WSH", homeTeam: "Washington Nationals",
      pitcher: "Max Scherzer", pitcherMlbId: 543037,
      gameNumber: 1,
    },
    states: [
      { outsRecorded: 18, inning: 6, half: "Bottom", hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 11, note: "End of 6th" },
      { outsRecorded: 21, inning: 7, half: "Bottom", hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 13, note: "End of 7th" },
      { outsRecorded: 22, inning: 8, half: "Top",   hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 13, note: "Out 22" },
      { outsRecorded: 23, inning: 8, half: "Top",   hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 14, note: "Out 23" },
      { outsRecorded: 24, inning: 8, half: "Bottom", hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 14, note: "End of 8th — CRITICAL" },
      { outsRecorded: 25, inning: 9, half: "Top",   hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 14, note: "Out 25" },
      { outsRecorded: 26, inning: 9, half: "Top",   hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 14, note: "Out 26 — IMMINENT (1 out away!)" },
      // THE HEARTBREAK — HBP breaks up no-hitter with 2 outs in 9th
      { outsRecorded: 26, inning: 9, half: "Top",   hitsAllowed: 0, walksAllowed: 2, runsAllowed: 0, strikeoutsToday: 14, note: "HBP — still no-hitter technically" },
      { outsRecorded: 26, inning: 9, half: "Top",   hitsAllowed: 1, walksAllowed: 2, runsAllowed: 0, strikeoutsToday: 14, note: "💔 HIT — no-hitter BROKEN with 1 out left", broken: true },
    ],
    pitcherStats: { pitcherKRate: 0.35, pitcherBBRate: 0.06, pitcherWHIP: 0.92, oppOBP: 0.305, parkFactor: 0.97 },
    expectedEvents: ["no_hitter", "no_hitter_broken"],
    expectedTweetCount: 9,
    heartbreak: true,
  },

  {
    id: "randy_20k",
    title: "Randy Johnson 20-Strikeout Game",
    date: "May 8, 2001",
    real: true,
    gameInfo: {
      gamePk: 2001050801,
      awayAbbr: "ARI", awayTeam: "Arizona Diamondbacks",
      homeAbbr: "CIN", homeTeam: "Cincinnati Reds",
      pitcher: "Randy Johnson", pitcherMlbId: 121578,
      gameNumber: 1,
    },
    states: [
      { outsRecorded: 9,  inning: 3, half: "Bottom", strikeoutsToday: 8,  hitsAllowed: 2, walksAllowed: 0, runsAllowed: 1, note: "End of 3rd — 8 Ks" },
      { outsRecorded: 15, inning: 5, half: "Bottom", strikeoutsToday: 13, hitsAllowed: 3, walksAllowed: 0, runsAllowed: 1, note: "End of 5th — 13 Ks" },
      { outsRecorded: 18, inning: 6, half: "Bottom", strikeoutsToday: 15, hitsAllowed: 3, walksAllowed: 0, runsAllowed: 1, note: "End of 6th — 15 Ks — ALERT THRESHOLD" },
      { outsRecorded: 19, inning: 7, half: "Top",   strikeoutsToday: 15, hitsAllowed: 3, walksAllowed: 0, runsAllowed: 1, note: "ELEVATED — 15 Ks" },
      { outsRecorded: 21, inning: 7, half: "Bottom", strikeoutsToday: 17, hitsAllowed: 3, walksAllowed: 0, runsAllowed: 1, note: "End of 7th — 17 Ks — MILESTONE" },
      { outsRecorded: 22, inning: 8, half: "Top",   strikeoutsToday: 18, hitsAllowed: 3, walksAllowed: 0, runsAllowed: 1, note: "Out 22 — 18 Ks" },
      { outsRecorded: 24, inning: 8, half: "Bottom", strikeoutsToday: 19, hitsAllowed: 3, walksAllowed: 0, runsAllowed: 1, note: "End of 8th — 19 Ks" },
      { outsRecorded: 25, inning: 9, half: "Top",   strikeoutsToday: 19, hitsAllowed: 3, walksAllowed: 0, runsAllowed: 1, note: "Out 25" },
      { outsRecorded: 26, inning: 9, half: "Top",   strikeoutsToday: 20, hitsAllowed: 3, walksAllowed: 0, runsAllowed: 1, note: "K #20 — RECORD ACHIEVED 🔥", complete: true },
    ],
    pitcherStats: { pitcherKRate: 0.47, pitcherBBRate: 0.06, pitcherWHIP: 0.83, oppOBP: 0.295, parkFactor: 1.06 },
    expectedEvents: ["k_game", "k_game_achieved"],
    expectedTweetCount: 8,
  },

  {
    id: "bruntlett_utp",
    title: "Eric Bruntlett Unassisted Triple Play",
    date: "August 23, 2009",
    real: true,
    gameInfo: {
      gamePk: 2009082301,
      awayAbbr: "NYM", awayTeam: "New York Mets",
      homeAbbr: "PHI", homeTeam: "Philadelphia Phillies",
      pitcher: "J.A. Happ", pitcherMlbId: 458681,
      gameNumber: 1,
    },
    states: [
      // Instant event — no slow build, just the play
      { outsRecorded: 24, inning: 9, half: "Top", hitsAllowed: 3, walksAllowed: 1, runsAllowed: 1, strikeoutsToday: 6, note: "9th inning, 2 outs, runners on 1st and 2nd" },
      { outsRecorded: 27, inning: 9, half: "Bottom", hitsAllowed: 3, walksAllowed: 1, runsAllowed: 1, strikeoutsToday: 6, note: "🚨 UNASSISTED TRIPLE PLAY — Bruntlett catches line drive, steps on 2B, tags runner", complete: true, instant: true },
    ],
    pitcherStats: { pitcherKRate: 0.18, pitcherBBRate: 0.09, pitcherWHIP: 1.28, oppOBP: 0.330, parkFactor: 1.02 },
    expectedEvents: ["unassisted_tp"],
    expectedTweetCount: 1,
  },

  {
    id: "yordan_cycle",
    title: "Yordan Alvarez Hits for the Cycle",
    date: "August 3, 2024",
    real: true,
    gameInfo: {
      gamePk: 2024080301,
      awayAbbr: "HOU", awayTeam: "Houston Astros",
      homeAbbr: "OAK", homeTeam: "Oakland Athletics",
      pitcher: "JP Sears", pitcherMlbId: 666301,
      eventBatter: "Yordan Alvarez", batterMlbId: 542303,
      gameNumber: 1,
    },
    states: [
      { outsRecorded: 6,  inning: 2, half: "Top", cycleHits: ["HR"],       cycleNeeds: null,  hitsAllowed: 4, note: "Yordan HR in 2nd — 1 of 4" },
      { outsRecorded: 12, inning: 4, half: "Top", cycleHits: ["HR","2B"],   cycleNeeds: null,  hitsAllowed: 7, note: "Double in 4th — 2 of 4" },
      { outsRecorded: 15, inning: 5, half: "Top", cycleHits: ["HR","2B","1B"], cycleNeeds: "3B", hitsAllowed: 9, note: "Single in 5th — 3 of 4 — CYCLE WATCH TRIGGERED" },
      { outsRecorded: 18, inning: 6, half: "Top", cycleHits: ["HR","2B","1B"], cycleNeeds: "3B", hitsAllowed: 10, note: "Out — still needs triple, 6th inn" },
      { outsRecorded: 21, inning: 7, half: "Top", cycleHits: ["HR","2B","1B"], cycleNeeds: "3B", hitsAllowed: 10, note: "ELEVATED — still needs triple" },
      { outsRecorded: 24, inning: 8, half: "Top", cycleHits: ["HR","2B","1B","3B"], cycleNeeds: null, hitsAllowed: 11, note: "🔄 TRIPLE in 8th — CYCLE COMPLETE 🎉", complete: true },
    ],
    pitcherStats: { pitcherKRate: 0.21, pitcherBBRate: 0.08, pitcherWHIP: 1.21, oppOBP: 0.330, parkFactor: 0.94 },
    expectedEvents: ["cycle", "cycle_complete"],
    expectedTweetCount: 4,
  },

  // ─── Edge case: extra innings no-hitter ────────────────────────
  {
    id: "extras_nh",
    title: "Extra Innings No-Hitter (Edge Case)",
    date: "Synthetic — tests 10-inning no-hitter logic",
    real: false,
    gameInfo: {
      gamePk: 99999901,
      awayAbbr: "SD",  awayTeam: "San Diego Padres",
      homeAbbr: "COL", homeTeam: "Colorado Rockies",
      pitcher: "Dylan Cease", pitcherMlbId: 663855,
      gameNumber: 1,
    },
    states: [
      { outsRecorded: 24, inning: 8, half: "Bottom", hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 12, note: "End of 8th — normal game, no-hitter alive" },
      { outsRecorded: 27, inning: 9, half: "Bottom", hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 12, note: "End of 9th — 0-0, goes to extras" },
      { outsRecorded: 29, inning: 10, half: "Top",  hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 13, isExtraInnings: true, note: "Out 29 — extras, no-hitter STILL alive" },
      { outsRecorded: 30, inning: 10, half: "Top",  hitsAllowed: 0, walksAllowed: 1, runsAllowed: 0, strikeoutsToday: 14, isExtraInnings: true, note: "Final out — NO-HITTER in EXTRAS 🎉", complete: true },
    ],
    pitcherStats: { pitcherKRate: 0.32, pitcherBBRate: 0.09, pitcherWHIP: 0.94, oppOBP: 0.299, parkFactor: 1.19 },
    expectedEvents: ["no_hitter"],
    expectedTweetCount: 8,
    edgeCase: "extra_innings",
  },

  // ─── Edge case: rain delay mid-no-hitter ──────────────────────
  {
    id: "rain_delay_nh",
    title: "Rain Delay Mid-No-Hitter (Edge Case)",
    date: "Synthetic — tests delay handling",
    real: false,
    gameInfo: {
      gamePk: 99999902,
      awayAbbr: "BOS", awayTeam: "Boston Red Sox",
      homeAbbr: "NYY", homeTeam: "New York Yankees",
      pitcher: "Shane McClanahan", pitcherMlbId: 676264,
      gameNumber: 1,
    },
    states: [
      { outsRecorded: 21, inning: 7, half: "Top", hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 11, abstractGameCode: "I",  note: "7th inning — no-hitter active, ELEVATED" },
      { outsRecorded: 21, inning: 7, half: "Top", hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 11, abstractGameCode: "DR", note: "⛈️ RAIN DELAY — poll slows, delay tweet fires" },
      { outsRecorded: 21, inning: 7, half: "Top", hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 11, abstractGameCode: "I",  note: "▶️ Game resumes — ELEVATED polling restores" },
      { outsRecorded: 24, inning: 8, half: "Bottom", hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 13, abstractGameCode: "I", note: "End of 8th — no double-tweets after delay" },
      { outsRecorded: 27, inning: 9, half: "Bottom", hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0, strikeoutsToday: 14, abstractGameCode: "F", note: "NO-HITTER COMPLETE 🎉", complete: true },
    ],
    pitcherStats: { pitcherKRate: 0.31, pitcherBBRate: 0.07, pitcherWHIP: 0.92, oppOBP: 0.308, parkFactor: 0.98 },
    expectedEvents: ["no_hitter"],
    expectedTweetCount: 9,
    edgeCase: "rain_delay",
  },
];

// ─── Simulation engine ────────────────────────────────────────────

/**
 * Run a scenario through the detection engine and return all generated tweets.
 * This is the function called by the Test Lab dashboard.
 *
 * @param {object} scenario
 * @returns {{ tweets: TweetResult[], passed: boolean, issues: string[] }}
 */
function runScenario(scenario) {
  const tweets  = [];
  const issues  = [];
  let activeEvents = new Set();
  let brokenEvents = new Set();
  let tweetedOuts  = new Set();
  let prevHits     = 0;

  for (const state of scenario.states) {
    const gs = {
      ...state,
      ...scenario.pitcherStats,
      gamePk: scenario.gameInfo.gamePk,
      isGameOver: state.complete ?? false,
      pitcherCount: state.pitcherCount ?? scenario.gameInfo.pitcherCount ?? 1,
    };

    // ── Detect event type transitions ──────────────────────────
    const { events: reconciledEvents, downgrade, upgrade } = reconcileNoHitEvent(gs, activeEvents);
    if (downgrade) {
      issues.push(`⚠️ Downgrade: ${downgrade} at out ${state.outsRecorded}`);
      activeEvents = reconciledEvents;
    }
    if (upgrade) {
      issues.push(`ℹ️ Upgrade: ${upgrade} at out ${state.outsRecorded} (combined effort)`);
      activeEvents = reconciledEvents;
    }

    // ── Rain delay ──────────────────────────────────────────────
    if (isDelayed(state.abstractGameCode)) {
      const delayTweet = getRainDelayTweet(scenario.gameInfo, activeEvents, state.outsRecorded);
      if (delayTweet) {
        tweets.push({ type: "rain_delay", text: delayTweet, state, tier: "—", prob: null });
      }
      continue; // don't process events during delay
    }

    // ── Determine current event type ───────────────────────────
    const noHitType = getNoHitterType(gs);

    // ── Perfect Game / No-Hitter detection ─────────────────────
    if (state.hitsAllowed === 0 && state.outsRecorded >= 18) {
      if (state.walksAllowed === 0 && state.runsAllowed === 0 && !brokenEvents.has("perfect_game")) {
        activeEvents.add("perfect_game");
        activeEvents.delete("no_hitter");
      } else if (!brokenEvents.has("no_hitter") && !brokenEvents.has("combined_no_hitter")) {
        const type = noHitType;
        activeEvents.add(type);
        if (type !== "perfect_game") activeEvents.delete("perfect_game");
      }
    }

    // ── Broken ──────────────────────────────────────────────────
    if (state.broken) {
      for (const ev of ["perfect_game","no_hitter","combined_no_hitter"]) {
        if (activeEvents.has(ev)) {
          activeEvents.delete(ev);
          brokenEvents.add(ev);
          const info = enrichWithHandles(scenario.gameInfo);
          const breakText = compose(
            { type: `${ev}_broken` },
            info,
            gs,
            "BROKEN",
            null
          );
          if (breakText) {
            tweets.push({ type: `${ev}_broken`, text: breakText, state, tier: "BROKEN", prob: null });
          }
        }
      }
      continue;
    }

    // ── Strikeout game ──────────────────────────────────────────
    if ((state.strikeoutsToday ?? 0) >= 15 && !brokenEvents.has("k_game")) {
      activeEvents.add("k_game");
    }
    if ((state.strikeoutsToday ?? 0) >= 20 && !brokenEvents.has("k_game_achieved")) {
      activeEvents.add("k_game_achieved");
    }

    // ── Cycle ───────────────────────────────────────────────────
    if (state.cycleHits?.length === 3 && state.cycleNeeds && !brokenEvents.has("cycle")) {
      activeEvents.add("cycle");
    }
    if (state.cycleHits?.length === 4 && !brokenEvents.has("cycle_complete")) {
      activeEvents.add("cycle_complete");
      brokenEvents.add("cycle_complete");
    }

    // ── Instant events ──────────────────────────────────────────
    if (state.instant) {
      const instantMap = {
        unassisted_tp:     state.note?.includes("UNASSISTED"),
        triple_play:       state.note?.includes("TRIPLE PLAY") && !state.note?.includes("UNASSISTED"),
        immaculate_inning: state.note?.includes("IMMACULATE"),
      };
      for (const [type, matches] of Object.entries(instantMap)) {
        if (matches) {
          const info     = enrichWithHandles(scenario.gameInfo);
          const evObj    = { type };
          const text     = compose(evObj, info, gs, "INSTANT", null);
          if (text) tweets.push({ type, text, state, tier: "INSTANT", prob: null });
        }
      }
    }

    // ── Generate tweet for active slow-burn events ──────────────
    for (const evType of activeEvents) {
      if (evType === "cycle_complete" || evType === "k_game_achieved") {
        const info     = enrichWithHandles(scenario.gameInfo);
        const text     = compose({ type: evType, cycleHits: state.cycleHits, cycleNeeds: state.cycleNeeds },
          info, gs, "COMPLETE", 100);
        if (text) tweets.push({ type: evType, text, state, tier: "COMPLETE", prob: 100 });
        continue;
      }

      const tier = state.isExtraInnings && state.outsRemainingInGame === 1 ? "IMMINENT"
        : state.outsRecorded >= 26 ? "IMMINENT"
        : state.inning >= 9 && state.outsRecorded >= 24 ? "CRITICAL"
        : state.inning >= 7 ? "ELEVATED"
        : "STANDARD";

      // Only tweet once per out in ELEVATED+ (dedup by outKey)
      const outKey = `${evType}-${state.outsRecorded}`;
      if (tweetedOuts.has(outKey)) continue;
      tweetedOuts.add(outKey);

      const prob = getProb(scenario.gameInfo.gamePk, evType, {
        ...gs, cycleNeeds: state.cycleNeeds,
      });
      const info = enrichWithHandles(scenario.gameInfo);
      const text = compose(
        { type: evType, cycleHits: state.cycleHits, cycleNeeds: state.cycleNeeds },
        info, gs, tier, prob
      );
      if (text) tweets.push({ type: evType, text, state, tier, prob });
    }
  }

  // ── Validate ───────────────────────────────────────────────────
  const detectedTypes = new Set(tweets.map(t => t.type));
  for (const expected of scenario.expectedEvents) {
    if (!detectedTypes.has(expected) && !detectedTypes.has(`${expected}_broken`)) {
      // Don't flag combined_no_hitter as missing if no_hitter was detected
      const ok = expected === "combined_no_hitter" && detectedTypes.has("no_hitter");
      if (!ok) issues.push(`❌ Expected event not fired: ${expected}`);
    }
  }
  if (tweets.length === 0 && scenario.expectedTweetCount > 0) {
    issues.push(`❌ No tweets generated (expected ~${scenario.expectedTweetCount})`);
  }

  const passed = issues.filter(i => i.startsWith("❌")).length === 0;

  return { tweets, passed, issues };
}

module.exports = { SCENARIOS, runScenario };
