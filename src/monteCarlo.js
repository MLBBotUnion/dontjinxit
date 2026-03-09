/**
 * monteCarlo.js
 * Server-side Monte Carlo engine.
 * Runs 10,000 simulations to estimate probability of completing a rare event.
 * Re-runs automatically in ELEVATED tier after every out.
 * Synchronous and CPU-cheap — completes in ~30ms on a free-tier VM.
 */

const N = 10_000;

/**
 * Main entry point.
 * @param {string} eventId  - e.g. "perfect_game", "no_hitter"
 * @param {object} gs       - game state snapshot
 * @returns {number}        - integer 0–100
 */
function simulate(eventId, gs) {
  const {
    outsRecorded   = 0,
    pitcherKRate   = 0.24,  // league-avg fallback
    pitcherBBRate  = 0.08,
    pitcherWHIP   = 1.20,
    oppOBP         = 0.320,
    parkFactor     = 1.00,
    strikeoutsToday = 0,
    cycleNeeds     = null,
  } = gs;

  const outsRemaining = 27 - outsRecorded;
  if (outsRemaining <= 0) return eventId.endsWith("_broken") ? 0 : 100;

  // Per-PA probabilities derived from pitcher and opponent stats
  // WHIP proxy: (H + BB) / IP → adjusts hit/walk blend
  const hitProb = Math.max(0.04,
    (oppOBP - pitcherBBRate) * parkFactor * (1 - (pitcherKRate / 0.25) * 0.25)
  );
  const bbProb  = Math.max(0.02, pitcherBBRate * (1 + (pitcherWHIP - 1.2) * 0.4));
  const kProb   = Math.min(0.45, pitcherKRate * (1.9 - parkFactor * 0.9));

  // Historical base rate — caps very low-out estimates
  const BASE_RATES = {
    perfect_game:        0.00044,
    no_hitter:           0.0033,
    combined_no_hitter:  0.005,
    shutout:             0.040,
    k_game:              0.00003,
    cycle:               0.0018,
  };
  const baseRate = BASE_RATES[eventId] ?? 0.001;

  // Very early innings: blend simulation with historical base rate
  const simWeight = Math.min(1, outsRecorded / 9);  // full weight after 3 inn

  let successes = 0;

  for (let sim = 0; sim < N; sim++) {
    let success = true;
    let simOuts = outsRecorded;
    let simKs   = strikeoutsToday;

    // Simulate each remaining PA
    while (simOuts < 27) {
      const r = Math.random();

      if (eventId === "perfect_game") {
        if (r < hitProb + bbProb) { success = false; break; }

      } else if (eventId === "no_hitter" || eventId === "combined_no_hitter") {
        if (r < hitProb) { success = false; break; }

      } else if (eventId === "shutout") {
        // Simplified: each PA has a chance of generating a run
        const runProb = oppOBP * 0.30 * parkFactor;
        if (r < runProb) { success = false; break; }

      } else if (eventId === "k_game") {
        if (r < kProb) simKs++;
        // Check if 20 Ks reachable in remaining PAs
        const kNeeded = 20 - simKs;
        const pasLeft = 27 - simOuts;
        if (kNeeded > pasLeft) { success = false; break; }

      } else if (eventId === "cycle") {
        // Simulate remaining PAs, check if cycleNeeds hit type appears
        const tripleProb = 0.06 * parkFactor;
        const doubleProb = 0.20;
        const hrProb     = 0.12;
        const singleProb = 0.28;
        const hitTypeProb = cycleNeeds === "3B" ? tripleProb
          : cycleNeeds === "2B" ? doubleProb
          : cycleNeeds === "HR" ? hrProb
          : singleProb;
        // Estimate PAs remaining for this batter (roughly 1 more PA per 3 outs left)
        const pasRemaining = Math.max(1, Math.round((27 - simOuts) / 3));
        let found = false;
        for (let pa = 0; pa < pasRemaining; pa++) {
          if (Math.random() < hitTypeProb) { found = true; break; }
        }
        success = found;
        break; // cycle check is one-shot
      }

      simOuts++;
    }

    if (eventId === "k_game" && simKs < 20) success = false;
    if (success) successes++;
  }

  const simProb = successes / N;

  // Blend with historical base rate at low out counts
  const blended = simWeight * simProb + (1 - simWeight) * baseRate * (27 / Math.max(1, outsRemaining));

  return Math.round(Math.min(100, Math.max(0, blended * 100)));
}

/**
 * Cache layer — avoids re-running identical state twice in one poll cycle.
 * Key: `{gamePk}-{eventId}-{outsRecorded}`
 */
const cache = new Map();
const CACHE_TTL = 8_000; // 8 seconds

function getCached(gamePk, eventId, gs) {
  const key = `${gamePk}-${eventId}-${gs.outsRecorded}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.prob;
  return null;
}

function setCache(gamePk, eventId, gs, prob) {
  const key = `${gamePk}-${eventId}-${gs.outsRecorded}`;
  cache.set(key, { prob, ts: Date.now() });
  // Prune old entries
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.ts > CACHE_TTL * 5) cache.delete(k);
    }
  }
}

function getProb(gamePk, eventId, gs) {
  const cached = getCached(gamePk, eventId, gs);
  if (cached !== null) return cached;
  const prob = simulate(eventId, gs);
  setCache(gamePk, eventId, gs, prob);
  return prob;
}

module.exports = { simulate, getProb };
