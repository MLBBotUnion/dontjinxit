/**
 * tweetComposer.js
 * Builds tweet text from rare event data.
 *
 * X Free tier = write-only, 1,500 posts/month, NO media upload.
 * All tweets are text-only. This keeps us at $0/month.
 *
 * Monthly budget math:
 *   ~180 game days/season × ~15 games/day = 2,700 games
 *   Rare events: ~3–5/week = ~80/season
 *   ELEVATED tweets (8–10 per event): ~800 total
 *   Heartbreak tweets: ~40
 *   TOTAL: ~840 tweets/season, well under 1,500/month
 */

const INN = ["1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"];

function innLabel(n) { return INN[n - 1] ?? `${n}th`; }

function buildTags(info) {
  const tags = [];
  if (info.awayHandle)    tags.push(info.awayHandle);
  if (info.homeHandle)    tags.push(info.homeHandle);
  if (info.pitcherHandle) tags.push(info.pitcherHandle);
  if (info.batterHandle)  tags.push(info.batterHandle);
  return tags.join(" ");
}

// ─── Slow-burn tweet templates ────────────────────────────────────

function perfectGame(info, outsRecorded, prob, tier) {
  const left = 27 - outsRecorded;
  const urgency = tier === "IMMINENT" ? "🚨🚨 ONE OUT AWAY."
    : tier === "CRITICAL"             ? "🚨 FINAL INNING."
    : tier === "ELEVATED"             ? "🚨 WATCH THIS."
    :                                   "🚨 DON'T JINX IT.";

  return trim280(`${urgency}

${info.pitcher} — ${outsRecorded} up, ${outsRecorded} down.

${left} out${left !== 1 ? "s" : ""} from perfection.

MC probability: ${prob}%

${info.awayAbbr} ${info.awayScore}–${info.homeScore} ${info.homeAbbr}

${buildTags(info)}
#MLB #DontJinxIt`);
}

function noHitter(info, outsRecorded, prob, tier) {
  const left = 27 - outsRecorded;
  const prefix = tier === "IMMINENT" ? "🤫 ONE OUT."
    : tier === "CRITICAL"            ? "🤫 FINAL INNING."
    :                                  "🤫";

  return trim280(`${prefix}

${info.pitcher}. ${outsRecorded} batters. No hits.

${left} out${left !== 1 ? "s" : ""} remaining.

MC: ${prob}%

${info.awayAbbr} ${info.awayScore}–${info.homeScore} ${info.homeAbbr}

${buildTags(info)}
#MLB #DontJinxIt`);
}

function shutout(info, outsRecorded, prob, tier) {
  const left = 27 - outsRecorded;
  return trim280(`🔒 SHUTOUT WATCH.

${info.pitcher} — ${left} out${left !== 1 ? "s" : ""} left to blank ${info.awayAbbr}.

MC: ${prob}%

${info.awayAbbr} ${info.awayScore}–${info.homeScore} ${info.homeAbbr}

${buildTags(info)}
#MLB #DontJinxIt`);
}

function kGame(info, strikeouts, prob, tier) {
  const needed = 20 - strikeouts;
  return trim280(`🔥 ${strikeouts} STRIKEOUTS.

${info.pitcher} needs ${needed} more to reach 20.

Only 3 pitchers in MLB history have done it in 9 innings.

MC: ${prob}%

${buildTags(info)}
#MLB #DontJinxIt`);
}

function cycle(info, cycleHits, cycleNeeds, prob) {
  return trim280(`🔄 CYCLE WATCH.

${info.eventBatter} has ${cycleHits.join(", ")}.

Needs a ${cycleNeeds}.

MC: ${prob}% chance it happens.

${info.awayAbbr} ${info.awayScore}–${info.homeScore} ${info.homeAbbr}

${buildTags(info)}
#MLB #Cycle #DontJinxIt`);
}

// ─── Heartbreak templates ─────────────────────────────────────────

function brokenPerfect(info, inning) {
  return trim280(`💔 It's over.

${info.pitcher} lost the perfect game in the ${innLabel(inning)}.

23 in all of MLB history. So close.

#MLB #DontJinxIt`);
}

function brokenNoHitter(info, inning, outsRecorded) {
  return trim280(`💔 No-hitter broken.

${info.pitcher} gave up the first hit of the game in the ${innLabel(inning)}.

${outsRecorded} up, ${outsRecorded} down before that.

#MLB #DontJinxIt`);
}

function brokenShutout(info, inning) {
  return trim280(`💔 Shutout broken in the ${innLabel(inning)}.

${info.pitcher} had blanked ${info.awayAbbr} through ${inning - 1} innings.

#MLB #DontJinxIt`);
}

// ─── Instant event templates ──────────────────────────────────────

function triplePlay(info, isUnassisted) {
  if (isUnassisted) {
    return trim280(`🚨 UNASSISTED TRIPLE PLAY.

One fielder. Three outs. One play.

15 in ALL of MLB history.

Stop everything.

${buildTags(info)}
#MLB #History #DontJinxIt`);
  }
  return trim280(`🎯 TRIPLE PLAY.

Three outs. One play.

~700 in MLB history.

${info.awayAbbr} ${info.awayScore}–${info.homeScore} ${info.homeAbbr}

${buildTags(info)}
#MLB #TriplePlay #DontJinxIt`);
}

function immaculateInning(info) {
  return trim280(`💎 IMMACULATE INNING.

${info.pitcher} — 9 pitches. 9 strikes. 3 Ks.

Fewer than 100 in MLB history.

${buildTags(info)}
#MLB #ImmaculateInning #DontJinxIt`);
}

function fourHR(info, batter) {
  return trim280(`💥 ${batter} — 4th HOME RUN.

Only 18 players in MLB history have hit 4 in a single game.

You are watching history.

${buildTags(info)}
#MLB #History #DontJinxIt`);
}

function walkoffGrandSlam(info, batter) {
  return trim280(`🎇 WALK-OFF GRAND SLAM.

${batter} ends it.

${info.homeAbbr} win. Game over.

${buildTags(info)}
#MLB #WalkOff #GrandSlam #DontJinxIt`);
}

function insideParkHR(info, batter) {
  return trim280(`🏃 INSIDE-THE-PARK HOME RUN.

${batter} — no wall needed.

~15 of these happen in an entire MLB season.

${buildTags(info)}
#MLB #InsideThePark #DontJinxIt`);
}

function cycleComplete(info, batter) {
  return trim280(`🔄 HIT FOR THE CYCLE.

${batter} goes 1B–2B–3B–HR.

~350 cycles in MLB history.

${buildTags(info)}
#MLB #Cycle #DontJinxIt`);
}

// ─── Trim to 280 ─────────────────────────────────────────────────
function trim280(text) {
  if (text.length <= 280) return text;
  return text.slice(0, 277) + "...";
}

// ─── Main dispatch ────────────────────────────────────────────────
/**
 * Compose a tweet string from a rare event object.
 * @param {object} ev       - event from mlbPoller
 * @param {object} gameInfo - game metadata (teams, pitcher, scores)
 * @param {object} gs       - current game state
 * @param {string} tier     - STANDARD | ELEVATED | CRITICAL | IMMINENT
 * @param {number} prob     - MC probability (0–100)
 * @returns {string|null}   - tweet text, or null if not tweetable
 */
function compose(ev, gameInfo, gs, tier, prob) {
  const info = {
    ...gameInfo,
    awayScore:    gs.awayScore ?? 0,
    homeScore:    gs.homeScore ?? 0,
    outsRecorded: gs.outsRecorded,
  };

  switch (ev.type) {
    // Slow-burn alerts
    case "perfect_game":    return perfectGame(info, gs.outsRecorded, prob, tier);
    case "no_hitter":       return noHitter(info, gs.outsRecorded, prob, tier);
    case "shutout":         return shutout(info, gs.outsRecorded, prob, tier);
    case "k_game":          return kGame(info, gs.strikeoutsToday, prob, tier);
    case "cycle":           return cycle(info, ev.cycleHits, ev.cycleNeeds, prob);

    // Heartbreaks
    case "perfect_game_broken": return brokenPerfect(info, gs.inning);
    case "no_hitter_broken":    return brokenNoHitter(info, gs.inning, gs.outsRecorded);
    case "shutout_broken":      return brokenShutout(info, gs.inning);

    // Instant events
    case "triple_play":         return triplePlay(info, false);
    case "unassisted_tp":       return triplePlay(info, true);
    case "immaculate_inning":   return immaculateInning(info);
    case "four_hr":             return fourHR(info, ev.play?.matchup?.batter?.fullName ?? "Batter");
    case "walkoff_grand_slam":  return walkoffGrandSlam(info, ev.play?.matchup?.batter?.fullName ?? "Batter");
    case "inside_park_hr":      return insideParkHR(info, ev.play?.matchup?.batter?.fullName ?? "Batter");
    case "cycle_complete":      return cycleComplete(info, ev.play?.matchup?.batter?.fullName ?? "Batter");
    case "k_game_achieved":     return kGame(info, gs.strikeoutsToday, 100, "ACHIEVED");

    default:
      console.warn("[tweetComposer] Unknown event type:", ev.type);
      return null;
  }
}

module.exports = { compose };
