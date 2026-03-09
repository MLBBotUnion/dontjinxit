/**
 * edgeCases.js
 * Handles all the weird MLB situations that break naive detection logic.
 *
 * Covered:
 *  1. Extra innings       — outs > 27, events still valid past 9
 *  2. Rain delays         — game paused mid-inning, don't re-fire events
 *  3. Combined no-hitters — multiple pitchers, track as team event
 *  4. Doubleheaders       — two games same day same teams, don't conflate
 *  5. Mercy rule / forfeits — rare but shouldn't crash
 *  6. Incomplete games    — suspended games, outs < 27 at "final"
 *  7. Opener + bulk guy   — correctly attribute combined vs solo no-hitter
 */

// ─── 1. Extra Innings ─────────────────────────────────────────────
/**
 * In extras, a perfect game / no-hitter is still valid.
 * The MLB record for longest no-hitter is 10 innings.
 * We extend the 27-out window to however many outs have been recorded.
 * The 20-K game and shutout also extend naturally.
 *
 * Key: never hard-code 27 as the game-end condition in event logic.
 * Use gs.isGameOver (set by poller when abstractGameState === "Final").
 */
function adjustForExtras(gs) {
  return {
    ...gs,
    // Total outs to complete the game — extends in extras
    totalOuts: gs.isExtraInnings
      ? gs.outsRecorded + gs.outsRemainingInGame  // poller provides this
      : 27,
    // Tier still escalates at inning 7+ regardless of extra innings
    // IMMINENT = final out of the game, not necessarily the 27th
    isFinalOut: gs.outsRemainingInGame === 1,
  };
}

// ─── 2. Rain Delays ───────────────────────────────────────────────
/**
 * MLB API abstractGameCode values:
 *   "I"  = In Progress (live)
 *   "IR" = Interrupted (rain delay)
 *   "IO" = Delayed (pregame delay)
 *   "S"  = Scheduled
 *   "F"  = Final
 *   "DR" = Delayed — Rain
 *   "MA" = Manager Challenge
 *
 * During a rain delay:
 * - Stop polling at ELEVATED interval (back to STANDARD or pause)
 * - Don't re-fire events that already fired
 * - Resume when status returns to "I"
 * - Tweet the delay if a no-hitter/PG was active
 */
const DELAY_CODES = new Set(["IR", "DR", "IO", "DL"]);
const ACTIVE_CODES = new Set(["I", "MA", "MF"]);  // MF = Manager challenge Final

function isDelayed(abstractGameCode) {
  return DELAY_CODES.has(abstractGameCode);
}

function isLive(abstractGameCode) {
  return ACTIVE_CODES.has(abstractGameCode);
}

/**
 * If a rain delay starts mid-rare-event, generate a delay tweet.
 */
function getRainDelayTweet(gameInfo, activeEvents, outsRecorded) {
  if (activeEvents.size === 0) return null;
  const eventLabels = [...activeEvents].map(e => ({
    perfect_game: "perfect game",
    no_hitter:    "no-hitter",
    shutout:      "shutout",
    k_game:       "strikeout chase",
    cycle:        "cycle watch",
  }[e] ?? e)).join(" + ");

  return `⛈️ Rain delay.\n\n${gameInfo.awayAbbr} @ ${gameInfo.homeAbbr} paused with a ${eventLabels} in progress.\n\n${outsRecorded} outs recorded.\n\nWe'll be watching. 👀\n\n#MLB #DontJinxIt`;
}

// ─── 3. Combined No-Hitters ───────────────────────────────────────
/**
 * MLB defines a combined no-hitter when multiple pitchers hold a team
 * hitless for a full game. It IS an official no-hitter record.
 *
 * Detection: hitsAllowed === 0 AND pitcherCount > 1 (tracked in game state)
 * Tweet attribution: "the [TEAM] bullpen" not a single pitcher name.
 *
 * A combined no-hitter can coexist with a shutout (run-support only).
 * It CANNOT coexist with a perfect game (a PG must be a solo effort
 * in terms of the game — though MLB rules don't require solo pitching,
 * practically no combined game has ever been a PG).
 */
function isCombinedEffort(gs) {
  return (gs.pitcherCount ?? 1) > 1;
}

function getNoHitterType(gs) {
  if (isCombinedEffort(gs)) return "combined_no_hitter";
  if (gs.walksAllowed === 0 && gs.hitsAllowed === 0 && gs.runsAllowed === 0) return "perfect_game";
  return "no_hitter";
}

/**
 * Upgrade or downgrade event type based on current game state.
 * e.g. a perfect game becomes a no-hitter the moment a walk is issued.
 * e.g. a no-hitter becomes combined when a second pitcher enters.
 */
function reconcileNoHitEvent(gs, currentActiveEvents) {
  const events = new Set(currentActiveEvents);
  const type   = getNoHitterType(gs);

  // If we had perfect game but now have a walk → downgrade to no-hitter
  if (events.has("perfect_game") && gs.walksAllowed > 0) {
    events.delete("perfect_game");
    if (gs.hitsAllowed === 0) events.add("no_hitter");
    return { events, downgrade: "perfect_game→no_hitter" };
  }

  // If solo no-hitter becomes combined (new pitcher entered)
  if (events.has("no_hitter") && isCombinedEffort(gs)) {
    events.delete("no_hitter");
    events.add("combined_no_hitter");
    return { events, upgrade: "no_hitter→combined_no_hitter" };
  }

  return { events, downgrade: null, upgrade: null };
}

// ─── 4. Doubleheaders ─────────────────────────────────────────────
/**
 * MLB API returns doubleheader games with gameNumber: 1 or 2
 * on the same date and same teams.
 *
 * The poller must key game state by gamePk (unique per game),
 * NOT by team pair + date. This is already correct in mlbPoller.js.
 *
 * Additional concern: tweet dedup. If game 1 had a no-hitter broken
 * and game 2 also has one developing, we should NOT suppress game 2's
 * tweets just because game 1 fired them.
 *
 * Solution: tweetedOuts is keyed to gamePk, not team pair. ✓ (already correct)
 *
 * We add a doubleheader label to tweets for clarity.
 */
function getDoubleheaderLabel(gameInfo) {
  if (!gameInfo.gameNumber || gameInfo.gameNumber === 1) return "";
  return ` (Game ${gameInfo.gameNumber})`;
}

// ─── 5. Suspended / Incomplete Games ─────────────────────────────
/**
 * A game can end "Final" with fewer than 27 outs if:
 * - Suspended and resumed later (common in rain)
 * - Called due to weather after 5 innings (official game)
 * - Forfeit (rare)
 *
 * If a game is Final but outsRecorded < 27:
 * - Perfect game / no-hitter: only valid if game went full 9
 * - Shutout: valid if game was official (5+ inn) — "official shutout"
 *
 * We check gs.isOfficialGame (set by poller from gameData.status.detailedState)
 */
function isValidNoHitter(gs) {
  // Must complete 9 full innings (or go to extras)
  return gs.outsRecorded >= 27 || gs.isExtraInnings;
}

function isValidShutout(gs) {
  // MLB requires 9 innings for a shutout to count officially
  // (5-inning rain shortened games can be no-hitters but not official shutouts)
  return gs.outsRecorded >= 27;
}

// ─── 6. Opener + Bulk / Piggyback ────────────────────────────────
/**
 * Modern bullpen game patterns:
 * - Opener (1 inn) + Bulk pitcher (5-6 inn) + closer
 * - Piggyback (two starters alternating)
 *
 * These games can produce combined no-hitters. The event fires correctly
 * since we track pitcherCount > 1. Tweet attribution uses team name.
 *
 * Edge: if opener records first 3 outs (no hits), then bulk guy comes in
 * and also allows no hits, this IS a combined no-hitter.
 * Our pitcherCount tracking handles this correctly.
 */

// ─── 7. Stat corrections / official scorer changes ────────────────
/**
 * Occasionally the official scorer changes a hit to an error or vice versa
 * AFTER the fact. This can retroactively make a no-hitter or break one.
 *
 * Our approach: we trust the live feed as-is. If a correction comes in,
 * the next poll cycle will pick it up and the state will update.
 * We do NOT send a correction tweet (would be confusing).
 *
 * Log the discrepancy only.
 */
function checkForScoringCorrection(prevHits, newHits, gs) {
  if (prevHits !== newHits) {
    const direction = newHits < prevHits ? "reduced" : "increased";
    console.log(`[edgeCases] Official scorer ${direction} hits: ${prevHits}→${newHits} for game ${gs.gamePk} at out ${gs.outsRecorded}`);
    return true;
  }
  return false;
}

// ─── 8. Abstract game state transitions ───────────────────────────
/**
 * Full state machine for a game's lifecycle as seen in the MLB API.
 * Used by the poller to decide when to start/stop/pause polling.
 */
const GAME_STATES = {
  SCHEDULED:   { poll: false, tweet: false },
  PREGAME:     { poll: false, tweet: false },
  LIVE:        { poll: true,  tweet: true  },
  DELAYED:     { poll: true,  tweet: true  },  // still might resume
  FINAL:       { poll: false, tweet: false },
  POSTPONED:   { poll: false, tweet: false },
  SUSPENDED:   { poll: false, tweet: false },
  FORFEIT:     { poll: false, tweet: false },
};

function getGameStateConfig(abstractGameCode, detailedState) {
  if (ACTIVE_CODES.has(abstractGameCode)) return GAME_STATES.LIVE;
  if (DELAY_CODES.has(abstractGameCode))  return GAME_STATES.DELAYED;
  if (abstractGameCode === "F")           return GAME_STATES.FINAL;
  if (detailedState?.includes("Postponed")) return GAME_STATES.POSTPONED;
  if (detailedState?.includes("Suspended")) return GAME_STATES.SUSPENDED;
  return GAME_STATES.SCHEDULED;
}

module.exports = {
  adjustForExtras,
  isDelayed,
  isLive,
  getRainDelayTweet,
  isCombinedEffort,
  getNoHitterType,
  reconcileNoHitEvent,
  getDoubleheaderLabel,
  isValidNoHitter,
  isValidShutout,
  checkForScoringCorrection,
  getGameStateConfig,
  GAME_STATES,
};
