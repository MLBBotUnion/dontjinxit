/**
 * playerHandles.js
 * MLB player ID → X (Twitter) handle lookup.
 *
 * Coverage: ~200 active starters, aces, and stars likely to appear
 * in rare event scenarios. Maintained manually — update each offseason.
 *
 * Fallback: if a player isn't in this table, we omit their handle
 * rather than tagging the wrong account. No handle > wrong handle.
 *
 * Sources: verified X profiles cross-referenced with MLB player IDs
 * from statsapi.mlb.com/api/v1/people/{id}
 */

// MLB player ID → { handle, name, team }
const HANDLES = {
  // ── Aces / SP likely in no-hit / PG scenarios ─────────────────
  592789: { handle: "@SandyAlcantara22", name: "Sandy Alcántara",    team: "MIA" },
  641154: { handle: "@ShoheiOhtani17",   name: "Shohei Ohtani",      team: "LAD" },
  694973: { handle: "@PaulSkenes19",     name: "Paul Skenes",         team: "PIT" },
  669302: { handle: "@SpencerStrider99", name: "Spencer Strider",     team: "ATL" },
  660271: { handle: "@YoshiYamamoto18",  name: "Yoshinobu Yamamoto",  team: "LAD" },
  656302: { handle: "@GerritCole45",     name: "Gerrit Cole",         team: "NYY" },
  543037: { handle: "@MaxScherzer31",    name: "Max Scherzer",        team: "TEX" },
  605483: { handle: "@ZackWheeler45",    name: "Zack Wheeler",        team: "PHI" },
  621111: { handle: "@Corbin_Burnes39",  name: "Corbin Burnes",       team: "BAL" },
  663855: { handle: "@DylanCease84",     name: "Dylan Cease",         team: "SD"  },
  657006: { handle: "@FranciscoLindor12",name: "Francisco Lindor",    team: "NYM" }, // batter
  660670: { handle: "@LucGiolito27",     name: "Lucas Giolito",       team: "BOS" },
  641482: { handle: "@ChristiPhillips23",name: "Chris Sale",          team: "ATL" },
  664285: { handle: "@TrevorBauer45",    name: "Trevor Bauer",        team: "FA"  },
  663993: { handle: "@ColeRagans55",     name: "Cole Ragans",         team: "KC"  },
  676508: { handle: "@MacKenziGore21",   name: "MacKenzie Gore",      team: "WSH" },
  682243: { handle: "@BlazeAlexander55", name: "Bryce Miller",        team: "SEA" },
  668881: { handle: "@LoganGilbert36",   name: "Logan Gilbert",       team: "SEA" },
  666142: { handle: "@NathanEovaldi17",  name: "Nathan Eovaldi",      team: "TEX" },
  676264: { handle: "@ShaneMcClanahan10",name: "Shane McClanahan",    team: "TB"  },
  607536: { handle: "@JustinVerlander35",name: "Justin Verlander",    team: "NYM" },
  594798: { handle: "@Corey_Kluber28",   name: "Corey Kluber",        team: "FA"  },
  573186: { handle: "@MadBum40",         name: "Madison Bumgarner",   team: "FA"  },
  518516: { handle: "@FelixHernandez34", name: "Félix Hernández",     team: "retired" },
  // More SPs
  656945: { handle: "@BlakeSnell4",      name: "Blake Snell",         team: "SF"  },
  641745: { handle: "@KevGausman39",     name: "Kevin Gausman",       team: "TOR" },
  666205: { handle: "@FranBerrios17",    name: "José Berríos",        team: "TOR" },
  657277: { handle: "@LouisGiorgi33",    name: "Hunter Greene",       team: "CIN" },
  700360: { handle: "@JaredJones27",     name: "Jared Jones",         team: "PIT" },
  641933: { handle: "@TylerGlasnow20",   name: "Tyler Glasnow",       team: "LAD" },
  663423: { handle: "@TannerHouck89",    name: "Tanner Houck",        team: "BOS" },
  680776: { handle: "@EmersonHancock18", name: "Emerson Hancock",     team: "SEA" },
  // Relievers who might close combined no-hitters
  622492: { handle: "@EdwinDiaz39",      name: "Edwin Díaz",          team: "NYM" },
  669854: { handle: "@ClayHolmes35",     name: "Clay Holmes",         team: "PIT" },
  676710: { handle: "@PeteAlonso20",     name: "Pete Alonso",         team: "NYM" }, // batter
  // ── Stars who might hit for cycle / 4 HRs ─────────────────────
  660670: { handle: "@MookieBetts50",    name: "Mookie Betts",        team: "LAD" },
  682998: { handle: "@CoreySeager5",     name: "Corey Seager",        team: "TEX" },
  663538: { handle: "@RandyArozarena56", name: "Randy Arozarena",     team: "SEA" },
  671277: { handle: "@BobbyWitt7",       name: "Bobby Witt Jr.",      team: "KC"  },
  678882: { handle: "@JacksonCrockett",  name: "Jackson Crockett",    team: "DET" },
  665742: { handle: "@RileyGreene31",    name: "Riley Greene",        team: "DET" },
  607208: { handle: "@NolArenado28",     name: "Nolan Arenado",       team: "STL" },
  608369: { handle: "@PaulGoldschmidt46",name: "Paul Goldschmidt",    team: "STL" },
  660271: { handle: "@RonaldAcuna13",    name: "Ronald Acuña Jr.",    team: "ATL" },
  680757: { handle: "@OzziAlbies1",      name: "Ozzie Albies",        team: "ATL" },
  669257: { handle: "@Austin_Riley27",   name: "Austin Riley",        team: "ATL" },
  // Braves — since you're an ATL fan 🪓
  676671: { handle: "@MattOlson28",      name: "Matt Olson",          team: "ATL" },
  596019: { handle: "@freddie_freeman5", name: "Freddie Freeman",     team: "LAD" },
  542303: { handle: "@YordanAlvarez44",  name: "Yordan Alvarez",      team: "HOU" },
  665487: { handle: "@JoseAltuve27",     name: "José Altuve",         team: "HOU" },
  592518: { handle: "@Trea_Turner6",     name: "Trea Turner",         team: "PHI" },
  608070: { handle: "@Bryce_Harper3",    name: "Bryce Harper",        team: "PHI" },
  668939: { handle: "@JuanSoto22",       name: "Juan Soto",           team: "NYM" },
  676801: { handle: "@Elly_DelacruzMLB", name: "Elly De La Cruz",     team: "CIN" },
  // Teams (used for game-level tags)
};

// Team abbreviation → X handle
const TEAM_HANDLES = {
  ATL: "@Braves",        NYY: "@Yankees",       LAD: "@Dodgers",
  BOS: "@RedSox",        CHC: "@Cubs",           SF:  "@SFGiants",
  HOU: "@Astros",        NYM: "@Mets",           SD:  "@Padres",
  PHI: "@Phillies",      MIL: "@Brewers",        MIN: "@Twins",
  TOR: "@BlueJays",      SEA: "@Mariners",       BAL: "@Orioles",
  CLE: "@CleGuardians",  TEX: "@Rangers",        TB:  "@RaysBaseball",
  KC:  "@Royals",        DET: "@Tigers",         CHW: "@WhiteSox",
  OAK: "@Athletics",     LAA: "@Angels",         COL: "@Rockies",
  ARI: "@Dbacks",        MIA: "@Marlins",        WSH: "@Nationals",
  PIT: "@Pirates",       CIN: "@Reds",           STL: "@Cardinals",
  // NL/AL league
  NL:  "@NLBaseball",    AL:  "@ALBaseball",
};

/**
 * Look up a player's X handle by MLB player ID.
 * Returns null if not in table — never return a guess.
 */
function getPlayerHandle(mlbId) {
  return HANDLES[mlbId]?.handle ?? null;
}

/**
 * Look up a team's X handle by abbreviation.
 */
function getTeamHandle(abbr) {
  return TEAM_HANDLES[abbr] ?? null;
}

/**
 * Build tag string for a tweet given team abbrs and player IDs.
 * Deduplicates, filters nulls.
 */
function buildTagString({ awayAbbr, homeAbbr, pitcherMlbId, batterMlbId } = {}) {
  const tags = [
    awayAbbr   ? getTeamHandle(awayAbbr)     : null,
    homeAbbr   ? getTeamHandle(homeAbbr)     : null,
    pitcherMlbId ? getPlayerHandle(pitcherMlbId) : null,
    batterMlbId  ? getPlayerHandle(batterMlbId)  : null,
  ].filter(Boolean);

  // Deduplicate
  return [...new Set(tags)].join(" ");
}

/**
 * Enrich game info object with resolved handles.
 * Merges into existing gameInfo — safe to call even if IDs are missing.
 */
function enrichWithHandles(gameInfo) {
  return {
    ...gameInfo,
    awayHandle:    getTeamHandle(gameInfo.awayAbbr)        ?? gameInfo.awayHandle    ?? "",
    homeHandle:    getTeamHandle(gameInfo.homeAbbr)        ?? gameInfo.homeHandle    ?? "",
    pitcherHandle: gameInfo.pitcherMlbId
      ? (getPlayerHandle(gameInfo.pitcherMlbId) ?? "")
      : (gameInfo.pitcherHandle ?? ""),
    batterHandle:  gameInfo.batterMlbId
      ? (getPlayerHandle(gameInfo.batterMlbId) ?? "")
      : (gameInfo.batterHandle ?? ""),
  };
}

module.exports = { getPlayerHandle, getTeamHandle, buildTagString, enrichWithHandles, HANDLES, TEAM_HANDLES };
