const express = require("express");
const config = require("../../shared/utils/config");
const router = express.Router();

function nowIso() { return new Date().toISOString(); }
function futureIso(days = 365) { return new Date(Date.now() + days * 86400000).toISOString(); }
function pastIso(days = 30) { return new Date(Date.now() - days * 86400000).toISOString(); }

router.get("/fortnite/api/calendar/v1/timeline", (req, res) => {
  const season = config.season || 12;
  const build = config.build || "12.41";
  const events = [];

  // Season state for C2S2
  const activeEvents = [
    { eventType: `EventFlag.Season${season}`, activeSince: pastIso(60), activeUntil: futureIso(365) },
    { eventType: `EventFlag.LobbySeason${season}`, activeSince: pastIso(60), activeUntil: futureIso(365) },
  ];

  // C2S2 specific event flags (common for 12.41 setups)
  if (season === 12) {
    activeEvents.push({ eventType: "EventFlag.LobbySeason12", activeSince: pastIso(60), activeUntil: futureIso(365) });
    activeEvents.push({ eventType: "EventFlag.Season12.NoDoomsday", activeSince: pastIso(60), activeUntil: futureIso(365) }); // default safe
    // allow toggles via config
    if (config.features && config.features.events && config.features.events.c2s2) {
      const c2 = config.features.events.c2s2;
      if (c2.deviceEvent || c2.doomsday) {
        // replace NoDoomsday with event flags if desired
      }
    }
  }

  // Winterfest toggles (versions mentioned 11.31, 19.01, 23.10, 33.11) - enable if configured
  if (config.features && config.features.events && config.features.events.winterfest && config.features.events.winterfest.enabled) {
    const wf = config.features.events.winterfest;
    const ver = String(wf.version || "11.31");
    activeEvents.push({ eventType: "EventFlag.Winterfest", activeSince: pastIso(1), activeUntil: futureIso(30) });
    activeEvents.push({ eventType: `EventFlag.Winterfest.${ver.replace('.', '')}`, activeSince: pastIso(1), activeUntil: futureIso(30) });
  }

  const channels = {
    "client-matchmaking": {
      states: [{
        validFrom: pastIso(365),
        activeEvents: [],
        state: { region: { OCE: {}, ASIA: {}, NAE: {}, NAW: {}, EU: {}, BR: {}, ME: {}, NAC: {} } }
      }],
      cacheExpire: futureIso(1)
    },
    "client-events": {
      states: [{
        validFrom: pastIso(365),
        activeEvents: activeEvents,
        state: {
          activeStorefronts: [],
          eventNamedWeights: {},
          seasonNumber: season,
          seasonTemplateId: `AthenaSeason:athenaseason${season}`,
          matchXpBonusPoints: 0,
          seasonBegin: pastIso(60),
          seasonEnd: futureIso(365),
          seasonDisplayedEnd: futureIso(365),
          weeklyStoreEnd: futureIso(1),
          stwEventStoreEnd: futureIso(365),
          stwWeeklyStoreEnd: futureIso(365),
          sectionStoreEnds: { Featured: futureIso(1), Daily: futureIso(1) },
          dailyStoreEnd: futureIso(1),
        }
      }],
      cacheExpire: futureIso(1)
    }
  };

  res.json({
    channels,
    eventsTimeOffsetHrs: 0,
    cacheIntervalMins: 10,
    currentTime: nowIso(),
  });
});

module.exports = router;
