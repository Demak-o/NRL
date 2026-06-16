const POSITIONS = {
  FB: "Fullback",
  WG: "Wing",
  CE: "Centre",
  FE: "Five-eighth",
  HB: "Halfback",
  PR: "Prop",
  HK: "Hooker",
  SR: "Second row",
  LK: "Lock"
};

const RUN_ON = [
  ["1", "FB"], ["2", "WG"], ["3", "CE"], ["4", "CE"], ["5", "WG"],
  ["6", "FE"], ["7", "HB"], ["8", "PR"], ["9", "HK"], ["10", "PR"],
  ["11", "SR"], ["12", "SR"], ["13", "LK"]
];

const BENCH = [
  ["14", ["HK", "HB", "FE", "FB", "CE"]],
  ["15", ["PR", "LK"]],
  ["16", ["SR", "PR"]],
  ["17", ["LK", "SR", "PR"]]
];

const FIELD_SPOTS = [
  [12, 50], [26, 20], [27, 38], [27, 62], [26, 80], [39, 43], [39, 57],
  [51, 43], [48, 50], [51, 57], [61, 38], [61, 62], [64, 50]
];

const TEAM_SPOTS_AWAY = FIELD_SPOTS.map(([x, y]) => [100 - x, y]);

const els = {};
const state = {
  squads: window.NRL_SQUADS,
  homeId: "",
  awayId: "",
  style: "balanced",
  running: false,
  timer: null,
  minute: 0,
  ball: { x: 50, y: 50 },
  possession: "home",
  territory: 50,
  match: null,
  season: null
};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  enrichSquads();
  bindEvents();
  populateTeams();
  createSeason();
  resetMatch();
  renderAll();
});

function cacheElements() {
  for (const id of [
    "sourcePill", "syncButton", "teamSelect", "opponentSelect", "tempoRange",
    "defenceRange", "kickingRange", "benchRange", "speedRange", "tempoValue",
    "defenceValue", "kickingValue", "benchValue", "speedValue", "startButton",
    "pauseButton", "resetButton", "simRoundButton", "homeCrest", "awayCrest",
    "homeName", "awayName", "homeScore", "awayScore", "matchClock",
    "matchStatus", "ball", "playersLayer", "statsGrid", "commentary",
    "homeMomentum", "awayMomentum", "momentumBar", "lineupList", "benchList",
    "teamRating", "squadSearch", "squadList", "ladder"
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.teamSelect.addEventListener("change", () => {
    state.homeId = els.teamSelect.value;
    if (state.homeId === state.awayId) {
      state.awayId = firstOpponent(state.homeId);
      els.opponentSelect.value = state.awayId;
    }
    resetMatch();
    renderAll();
  });

  els.opponentSelect.addEventListener("change", () => {
    state.awayId = els.opponentSelect.value;
    if (state.homeId === state.awayId) {
      state.homeId = firstOpponent(state.awayId);
      els.teamSelect.value = state.homeId;
    }
    resetMatch();
    renderAll();
  });

  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.style = button.dataset.style;
      refreshLineups();
      renderMatchRead();
    });
  });

  for (const input of [els.tempoRange, els.defenceRange, els.kickingRange, els.benchRange, els.speedRange]) {
    input.addEventListener("input", () => {
      updateSliderLabels();
      refreshLineups();
      renderMatchRead();
      restartTimerIfNeeded();
    });
  }

  els.startButton.addEventListener("click", startMatch);
  els.pauseButton.addEventListener("click", pauseMatch);
  els.resetButton.addEventListener("click", () => {
    pauseMatch();
    resetMatch();
    renderAll();
  });
  els.squadSearch.addEventListener("input", renderSquadList);
  els.simRoundButton.addEventListener("click", simSeasonRound);
  els.syncButton.addEventListener("click", syncLiveSquads);
}

function populateTeams() {
  const teams = state.squads.teams;
  els.teamSelect.innerHTML = teams.map((team) => `<option value="${team.id}">${team.name}</option>`).join("");
  els.opponentSelect.innerHTML = teams.map((team) => `<option value="${team.id}">${team.name}</option>`).join("");
  state.homeId = teams.find((team) => team.name === "Brisbane Broncos")?.id || teams[0].id;
  state.awayId = teams.find((team) => team.name === "Melbourne Storm")?.id || teams[1].id;
  els.teamSelect.value = state.homeId;
  els.opponentSelect.value = state.awayId;
}

function enrichSquads() {
  state.squads.teams.forEach((team, teamIndex) => {
    team.players.forEach((player, playerIndex) => {
      player.stats = buildStats(player, teamIndex, playerIndex);
      player.rating = Math.round((player.stats.attack + player.stats.defence + player.stats.fitness + player.stats.kicking) / 4);
      player.fatigue = 0;
    });
  });
}

function buildStats(player, teamIndex, playerIndex) {
  const seed = hash(`${player.id}-${teamIndex}-${playerIndex}`);
  const gradeBoost = player.squad === "top30" ? 14 : player.squad === "supplementary" ? 7 : 2;
  const base = 55 + gradeBoost + (seed % 16);
  const positions = player.positions;
  const has = (code) => positions.includes(code);
  const back = has("FB") || has("WG") || has("CE");
  const spine = has("FB") || has("FE") || has("HB") || has("HK");
  const forward = has("PR") || has("SR") || has("LK");
  return {
    attack: clamp(base + (back ? 7 : 0) + (spine ? 5 : 0) - (has("PR") ? 2 : 0), 48, 96),
    defence: clamp(base + (forward ? 8 : 0) + (has("CE") ? 3 : 0), 48, 96),
    fitness: clamp(base + (has("LK") || has("SR") ? 6 : 0) + ((seed >> 3) % 8), 48, 96),
    kicking: clamp(base + (has("HB") ? 18 : 0) + (has("FE") ? 13 : 0) + (has("FB") ? 7 : 0) - (forward ? 7 : 0), 38, 96)
  };
}

function resetMatch() {
  const home = teamById(state.homeId);
  const away = teamById(state.awayId);
  state.minute = 0;
  state.running = false;
  state.possession = "home";
  state.territory = 50;
  state.ball = { x: 50, y: 50 };
  state.match = {
    home: buildMatchTeam(home, true),
    away: buildMatchTeam(away, false),
    score: { home: 0, away: 0 },
    stats: {
      home: blankStats(),
      away: blankStats()
    },
    events: [{ minute: 0, text: `${home.shortName} and ${away.shortName} are set.` }]
  };
  refreshLineups();
  if (els.matchStatus) els.matchStatus.textContent = "Ready";
}

function buildMatchTeam(team, isHuman) {
  const tactic = isHuman ? getHumanTactic() : getOpponentTactic(team);
  const lineup = pickLineup(team.players, tactic);
  return {
    ...team,
    tactic,
    runOn: lineup.runOn,
    bench: lineup.bench,
    rating: lineup.rating,
    usedBench: new Set()
  };
}

function refreshLineups() {
  if (!state.match) return;
  state.match.home.tactic = getHumanTactic();
  const lineup = pickLineup(teamById(state.homeId).players, state.match.home.tactic);
  state.match.home.runOn = lineup.runOn;
  state.match.home.bench = lineup.bench;
  state.match.home.rating = lineup.rating;
  state.match.away.tactic = getOpponentTactic(teamById(state.awayId));
  const awayLineup = pickLineup(teamById(state.awayId).players, state.match.away.tactic);
  state.match.away.runOn = awayLineup.runOn;
  state.match.away.bench = awayLineup.bench;
  state.match.away.rating = awayLineup.rating;
}

function pickLineup(players, tactic) {
  const selected = new Set();
  const runOn = RUN_ON.map(([jersey, role]) => {
    const player = bestForRole(players, role, selected, tactic);
    selected.add(player.id);
    return { jersey, role, player, fatigue: 0 };
  });
  const bench = BENCH.map(([jersey, roles]) => {
    const player = bestForRole(players, roles, selected, tactic);
    selected.add(player.id);
    return { jersey, role: roles[0], player, fatigue: 0 };
  });
  const rating = Math.round([...runOn, ...bench].reduce((total, item) => total + scoreForRole(item.player, item.role, tactic), 0) / 17);
  return { runOn, bench, rating };
}

function bestForRole(players, role, selected, tactic) {
  const roles = Array.isArray(role) ? role : [role];
  const pool = players.filter((player) => !selected.has(player.id));
  return pool.sort((a, b) => {
    const aFit = roles.some((code) => a.positions.includes(code)) ? 18 : 0;
    const bFit = roles.some((code) => b.positions.includes(code)) ? 18 : 0;
    return scoreForRole(b, roles[0], tactic) + bFit - (scoreForRole(a, roles[0], tactic) + aFit);
  })[0] || players[0];
}

function scoreForRole(player, role, tactic) {
  const fit = player.positions.includes(role) ? 10 : 0;
  const stats = player.stats;
  const tempoBoost = tactic.tempo > 65 ? stats.fitness * 0.1 : 0;
  if (["HB", "FE", "FB"].includes(role)) return stats.attack * 0.36 + stats.kicking * 0.34 + stats.fitness * 0.18 + stats.defence * 0.12 + fit + tempoBoost;
  if (["PR", "SR", "LK", "HK"].includes(role)) return stats.defence * 0.34 + stats.fitness * 0.28 + stats.attack * 0.24 + stats.kicking * 0.08 + fit + tempoBoost;
  return stats.attack * 0.4 + stats.fitness * 0.24 + stats.defence * 0.22 + stats.kicking * 0.08 + fit + tempoBoost;
}

function getHumanTactic() {
  return {
    style: state.style,
    tempo: Number(els.tempoRange?.value || 55),
    defence: Number(els.defenceRange?.value || 58),
    kicking: Number(els.kickingRange?.value || 52),
    benchMinute: Number(els.benchRange?.value || 45)
  };
}

function getOpponentTactic(team) {
  const seed = hash(team.id);
  return {
    style: ["balanced", "expansive", "territory"][seed % 3],
    tempo: 45 + (seed % 32),
    defence: 45 + ((seed >> 2) % 34),
    kicking: 44 + ((seed >> 4) % 38),
    benchMinute: 35 + ((seed >> 6) % 24)
  };
}

function startMatch() {
  if (state.minute >= 80) resetMatch();
  state.running = true;
  els.matchStatus.textContent = "Live";
  restartTimerIfNeeded();
}

function pauseMatch() {
  state.running = false;
  clearInterval(state.timer);
  state.timer = null;
  els.matchStatus.textContent = state.minute >= 80 ? "Full time" : "Paused";
}

function restartTimerIfNeeded() {
  if (!state.running) return;
  clearInterval(state.timer);
  state.timer = setInterval(tickMatch, Math.max(150, 950 - Number(els.speedRange.value) * 150));
}

function tickMatch() {
  if (state.minute >= 80) {
    finishMatch();
    return;
  }
  state.minute += 1;
  fatigueTick(state.match.home);
  fatigueTick(state.match.away);
  autoInterchange(state.match.home);
  autoInterchange(state.match.away);
  playMinute();
  renderAll();
}

function playMinute() {
  const attackKey = state.possession;
  const defendKey = attackKey === "home" ? "away" : "home";
  const attack = state.match[attackKey];
  const defend = state.match[defendKey];
  const pressure = teamPressure(attack, defend);
  const rand = seededMinuteRandom(state.minute, attack.id, defend.id);
  const carry = 5 + Math.round((pressure - 50) / 12) + Math.round((attack.tactic.tempo - 50) / 18);
  state.territory = clamp(state.territory + (attackKey === "home" ? carry : -carry), 4, 96);
  state.ball.x = attackKey === "home" ? state.territory : 100 - state.territory;
  state.ball.y = 38 + (rand * 24);

  state.match.stats[attackKey].meters += Math.max(18, Math.round(pressure * 0.9 + rand * 35));
  state.match.stats[defendKey].tackles += 5 + Math.floor(rand * 4);

  const eventRoll = rand * 100 + pressure * 0.12;
  if (eventRoll > 96 && inRedZone(attackKey)) {
    scoreTry(attackKey, attack, pressure, rand);
    return;
  }
  if (eventRoll > 88 && state.minute > 8) {
    lineBreak(attackKey, attack);
    return;
  }
  if (eventRoll < 10 + (attack.tactic.tempo - 50) / 8) {
    errorEvent(attackKey, defendKey, attack);
    return;
  }
  if (eventRoll > 78 && attack.tactic.kicking > 58 && state.minute > 20) {
    kickEvent(attackKey, defendKey, attack);
    return;
  }
  if (state.minute % 6 === 0) {
    setRestartEvent(attackKey, attack);
  }
}

function scoreTry(side, team, pressure, rand) {
  const scorer = chooseScorer(team, rand);
  const converted = rand + teamAverage(team, "kicking") / 140 > 0.78;
  state.match.score[side] += converted ? 6 : 4;
  state.match.stats[side].tries += 1;
  state.match.stats[side].lineBreaks += 1;
  state.match.events.unshift({
    minute: state.minute,
    text: `${team.shortName}: ${scorer.name} finishes a ${pressure > 60 ? "slick" : "scrappy"} set. ${converted ? "Converted." : "Conversion missed."}`
  });
  state.possession = side === "home" ? "away" : "home";
  state.territory = 50;
  state.ball = { x: 50, y: 50 };
}

function lineBreak(side, team) {
  const player = chooseScorer(team, seededMinuteRandom(state.minute + 7, team.id, "break"));
  state.match.stats[side].lineBreaks += 1;
  state.match.events.unshift({ minute: state.minute, text: `${player.name} breaks the line for ${team.shortName}.` });
  state.territory = clamp(state.territory + (side === "home" ? 14 : -14), 4, 96);
}

function errorEvent(attackKey, defendKey, team) {
  state.match.stats[attackKey].errors += 1;
  state.match.events.unshift({ minute: state.minute, text: `${team.shortName} lose shape and turn it over.` });
  state.possession = defendKey;
  state.territory = 100 - state.territory;
}

function kickEvent(attackKey, defendKey, team) {
  const kicker = bestKicker(team);
  const pinned = team.tactic.kicking + teamAverage(team, "kicking") > 132;
  state.match.events.unshift({ minute: state.minute, text: `${kicker.name} kicks ${pinned ? "deep into the corner" : "early for territory"}.` });
  state.possession = defendKey;
  state.territory = pinned ? 18 : 35;
}

function setRestartEvent(side, team) {
  state.match.stats[side].completions += 1;
  state.match.events.unshift({ minute: state.minute, text: `${team.shortName} complete the set and keep the pressure on.` });
}

function finishMatch() {
  pauseMatch();
  state.minute = 80;
  const home = state.match.home.shortName;
  const away = state.match.away.shortName;
  const score = state.match.score;
  const result = score.home === score.away ? "It ends level." : score.home > score.away ? `${home} win.` : `${away} win.`;
  state.match.events.unshift({ minute: 80, text: `Full time: ${home} ${score.home}, ${away} ${score.away}. ${result}` });
  els.matchStatus.textContent = "Full time";
  updateSeasonFromMatch();
  renderAll();
}

function fatigueTick(team) {
  const tempo = team.tactic.tempo;
  team.runOn.forEach((item, index) => {
    const load = 0.42 + tempo / 260 + (["PR", "SR", "LK", "HK"].includes(item.role) ? 0.1 : 0);
    item.fatigue = clamp(item.fatigue + load + index * 0.002, 0, 48);
  });
}

function autoInterchange(team) {
  if (state.minute < team.tactic.benchMinute) return;
  const tired = team.runOn
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.fatigue > 18)
    .sort((a, b) => b.item.fatigue - a.item.fatigue)[0];
  if (!tired) return;
  const bench = team.bench.find((item) => !team.usedBench.has(item.player.id));
  if (!bench) return;
  const old = tired.item;
  team.runOn[tired.index] = { ...bench, jersey: old.jersey, role: old.role, fatigue: Math.max(3, old.fatigue * 0.2) };
  team.usedBench.add(bench.player.id);
  state.match.events.unshift({ minute: state.minute, text: `${team.shortName} send ${bench.player.name} on for fresh legs.` });
}

function renderAll() {
  updateSliderLabels();
  renderHeader();
  renderPitch();
  renderLineup();
  renderSquadList();
  renderMatchRead();
  renderLadder();
}

function updateSliderLabels() {
  els.tempoValue.textContent = els.tempoRange.value;
  els.defenceValue.textContent = els.defenceRange.value;
  els.kickingValue.textContent = els.kickingRange.value;
  els.benchValue.textContent = `${els.benchRange.value}'`;
  els.speedValue.textContent = `${els.speedRange.value}x`;
}

function renderHeader() {
  const { home, away, score } = state.match;
  els.homeName.textContent = home.name;
  els.awayName.textContent = away.name;
  els.homeScore.textContent = score.home;
  els.awayScore.textContent = score.away;
  els.matchClock.textContent = `${state.minute}'`;
  renderCrest(els.homeCrest, home);
  renderCrest(els.awayCrest, away);
  const totalPlayers = state.squads.teams.reduce((total, team) => total + team.players.length, 0);
  els.sourcePill.textContent = `${state.squads.season} squads • ${totalPlayers} players • ${state.squads.generatedFrom}`;
}

function renderCrest(el, team) {
  el.textContent = initials(team.name);
  el.style.background = `linear-gradient(135deg, ${team.primary}, ${team.secondary})`;
}

function renderPitch() {
  const home = state.match.home;
  const away = state.match.away;
  els.ball.style.left = `${state.ball.x}%`;
  els.ball.style.top = `${state.ball.y}%`;
  const jitter = seededMinuteRandom(state.minute, state.homeId, state.awayId) * 3;
  const dots = [];
  home.runOn.forEach((item, index) => {
    const [x, y] = FIELD_SPOTS[index];
    dots.push(playerDot(item, home, x + attackingShift("home"), y + jitter - 1.5, ""));
  });
  away.runOn.forEach((item, index) => {
    const [x, y] = TEAM_SPOTS_AWAY[index];
    dots.push(playerDot(item, away, x + attackingShift("away"), y - jitter + 1.5, "away"));
  });
  els.playersLayer.innerHTML = dots.join("");
}

function playerDot(item, team, x, y, extraClass) {
  const bg = extraClass ? team.secondary : team.primary;
  const color = extraClass ? "#10130f" : "#ffffff";
  return `<div class="player-dot ${extraClass}" title="${escapeHtml(item.player.name)}" style="left:${clamp(x, 6, 94)}%;top:${clamp(y, 8, 92)}%;background:${bg};color:${color}">${item.jersey}</div>`;
}

function attackingShift(side) {
  const direction = state.possession === side ? 1 : -1;
  return direction * (state.territory - 50) * 0.18;
}

function renderLineup() {
  const team = state.match.home;
  els.teamRating.textContent = `${team.rating} OVR`;
  els.lineupList.innerHTML = team.runOn.map((item) => lineupItem(item, team)).join("");
  els.benchList.innerHTML = team.bench.map((item) => lineupItem(item, team)).join("");
}

function lineupItem(item, team) {
  const freshness = clamp(100 - item.fatigue * 2, 0, 100);
  return `
    <div class="lineup-item">
      <div class="jersey" style="background:${team.primary}">${item.jersey}</div>
      <div>
        <b>${escapeHtml(item.player.name)}</b>
        <span>${item.role} • ${item.player.positions.join("/")}</span>
      </div>
      <div class="fatigue"><div style="width:${freshness}%"></div></div>
    </div>
  `;
}

function renderSquadList() {
  const query = els.squadSearch.value.trim().toLowerCase();
  const team = teamById(state.homeId);
  const players = team.players
    .filter((player) => !query || player.name.toLowerCase().includes(query) || player.positions.join(" ").toLowerCase().includes(query))
    .sort((a, b) => b.rating - a.rating);
  els.squadList.innerHTML = players.map((player) => `
    <div class="squad-row">
      <div>
        <b>${escapeHtml(player.name)}</b>
        <span>${player.positions.map((code) => POSITIONS[code]).join(", ")} • ${player.squad}</span>
      </div>
      <strong>${player.rating}</strong>
    </div>
  `).join("");
}

function renderMatchRead() {
  const homePower = teamPower(state.match.home);
  const awayPower = teamPower(state.match.away);
  const total = homePower + awayPower;
  const homeMomentum = Math.round((homePower / total) * 100);
  els.homeMomentum.textContent = homeMomentum;
  els.awayMomentum.textContent = 100 - homeMomentum;
  els.momentumBar.style.width = `${homeMomentum}%`;
  els.momentumBar.style.background = homeMomentum >= 50 ? "var(--good)" : "var(--bad)";
  const stats = state.match.stats;
  els.statsGrid.innerHTML = [
    ["Possession", `${state.possession === "home" ? state.match.home.shortName : state.match.away.shortName}`],
    ["Territory", `${Math.round(state.territory)}m`],
    ["Meters", `${stats.home.meters}-${stats.away.meters}`],
    ["Line breaks", `${stats.home.lineBreaks}-${stats.away.lineBreaks}`],
    ["Errors", `${stats.home.errors}-${stats.away.errors}`],
    ["Tackles", `${stats.home.tackles}-${stats.away.tackles}`]
  ].map(([label, value]) => `<div class="stat-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  els.commentary.innerHTML = state.match.events.slice(0, 12).map((event) => `<li><b>${event.minute}'</b> ${escapeHtml(event.text)}</li>`).join("");
}

function createSeason() {
  state.season = {
    round: 1,
    playedMatches: new Set(),
    ladder: Object.fromEntries(state.squads.teams.map((team) => [team.id, {
      teamId: team.id,
      played: 0,
      points: 0,
      for: 0,
      against: 0
    }]))
  };
}

function simSeasonRound() {
  const teams = [...state.squads.teams];
  const used = new Set();
  for (let i = 0; i < teams.length; i += 1) {
    const home = teams[i];
    if (used.has(home.id)) continue;
    const opponent = teams.find((team) => team.id !== home.id && !used.has(team.id) && !state.season.playedMatches.has(matchKey(home.id, team.id)));
    if (!opponent) continue;
    const result = simResult(home, opponent);
    applySeasonResult(home.id, opponent.id, result.home, result.away);
    used.add(home.id);
    used.add(opponent.id);
  }
  state.season.round += 1;
  renderLadder();
}

function updateSeasonFromMatch() {
  const key = matchKey(state.homeId, state.awayId);
  if (state.season.playedMatches.has(key)) return;
  applySeasonResult(state.homeId, state.awayId, state.match.score.home, state.match.score.away);
}

function applySeasonResult(homeId, awayId, homeScore, awayScore) {
  const home = state.season.ladder[homeId];
  const away = state.season.ladder[awayId];
  home.played += 1;
  away.played += 1;
  home.for += homeScore;
  home.against += awayScore;
  away.for += awayScore;
  away.against += homeScore;
  if (homeScore === awayScore) {
    home.points += 1;
    away.points += 1;
  } else if (homeScore > awayScore) {
    home.points += 2;
  } else {
    away.points += 2;
  }
  state.season.playedMatches.add(matchKey(homeId, awayId));
}

function renderLadder() {
  const rows = Object.values(state.season.ladder)
    .sort((a, b) => b.points - a.points || (b.for - b.against) - (a.for - a.against) || b.for - a.for)
    .slice(0, 8);
  els.ladder.innerHTML = rows.map((row, index) => {
    const team = teamById(row.teamId);
    return `<div class="ladder-row"><span>${index + 1}</span><b>${team.shortName}</b><span>${row.played}</span><strong>${row.points}</strong></div>`;
  }).join("");
}

async function syncLiveSquads() {
  els.sourcePill.textContent = "Syncing squads...";
  try {
    const response = await fetch("https://en.wikipedia.org/api/rest_v1/page/html/List_of_current_NRL_team_squads");
    if (!response.ok) throw new Error("Roster source unavailable");
    const html = await response.text();
    const live = parseSquadsFromHtml(html);
    if (live.teams.length !== 17) throw new Error("Unexpected team count");
    state.squads = live;
    enrichSquads();
    populateTeams();
    createSeason();
    resetMatch();
    renderAll();
  } catch (error) {
    els.sourcePill.textContent = `Using seeded squads • sync blocked`;
  }
}

function parseSquadsFromHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const names = window.NRL_SQUADS.teams.map((team) => team.name);
  const teams = names.map((name) => {
    const seed = window.NRL_SQUADS.teams.find((team) => team.name === name);
    const h2 = [...doc.querySelectorAll("h2")].find((heading) => heading.textContent.trim() === name);
    if (!h2) return seed;
    const table = h2.parentElement?.nextElementSibling?.tagName === "TABLE" ? h2.parentElement.nextElementSibling : h2.nextElementSibling;
    const headCoach = [...table.querySelectorAll("p b")].find((b) => /Head coach/.test(b.textContent));
    const cutoffCell = headCoach?.closest("td");
    const players = [...table.querySelectorAll("li")]
      .filter((li) => li.querySelector("small") && (!cutoffCell || !cutoffCell.contains(li)))
      .map((li, index) => {
        const text = li.textContent.replace(/\s+/g, " ").trim();
        const [rawName, rawPositions = ""] = text.split(/\s+–\s+/);
        const positions = [...new Set(rawPositions.match(/\b(FB|WG|CE|FE|HB|PR|HK|SR|LK)\b/g) || [])];
        const cleanName = rawName.replace(/\s*\((c|vc)\)\s*/gi, "").trim();
        if (!cleanName || !positions.length) return null;
        return {
          id: `${seed.id}-${slug(cleanName)}`,
          name: cleanName,
          positions,
          squad: index < 30 ? "top30" : "supplementary"
        };
      }).filter(Boolean);
    return {
      ...seed,
      players: players.length ? players : seed.players,
      updated: "Live sync",
      source: seed.source
    };
  });
  return {
    season: 2026,
    sourcePage: window.NRL_SQUADS.sourcePage,
    sourceLabel: window.NRL_SQUADS.sourceLabel,
    generatedFrom: `Live sync ${new Date().toLocaleDateString()}`,
    teams
  };
}

function simResult(home, away) {
  const h = teamPower(buildMatchTeam(home, false));
  const a = teamPower(buildMatchTeam(away, false));
  const spread = clamp(Math.round((h - a) / 5), -18, 18);
  const base = 14 + (hash(home.id + away.id + state.season.round) % 18);
  return {
    home: Math.max(0, base + spread + (hash(home.id) % 8)),
    away: Math.max(0, base - spread + (hash(away.id) % 8))
  };
}

function blankStats() {
  return { meters: 0, lineBreaks: 0, errors: 0, tackles: 0, tries: 0, completions: 0 };
}

function teamPower(team) {
  const attack = teamAverage(team, "attack") + (team.tactic.style === "expansive" ? 4 : 0) + (team.tactic.tempo - 50) / 8;
  const defence = teamAverage(team, "defence") + (team.tactic.defence - 50) / 7;
  const kicking = teamAverage(team, "kicking") + (team.tactic.style === "territory" ? 4 : 0) + (team.tactic.kicking - 50) / 9;
  const fatigue = team.runOn.reduce((total, item) => total + item.fatigue, 0) / 13;
  return attack * 0.42 + defence * 0.37 + kicking * 0.18 - fatigue * 0.35;
}

function teamPressure(attack, defend) {
  return clamp(50 + teamPower(attack) - teamPower(defend), 15, 88);
}

function teamAverage(team, stat) {
  return team.runOn.reduce((total, item) => total + item.player.stats[stat], 0) / team.runOn.length;
}

function inRedZone(side) {
  return side === "home" ? state.territory > 78 : state.territory < 22;
}

function chooseScorer(team, rand) {
  const backs = team.runOn.filter((item) => ["FB", "WG", "CE", "FE", "HB"].includes(item.role));
  const pool = rand > 0.28 ? backs : team.runOn;
  return pool[Math.floor(rand * pool.length)]?.player || team.runOn[0].player;
}

function bestKicker(team) {
  return [...team.runOn].sort((a, b) => b.player.stats.kicking - a.player.stats.kicking)[0].player;
}

function firstOpponent(id) {
  return state.squads.teams.find((team) => team.id !== id)?.id || state.squads.teams[0].id;
}

function teamById(id) {
  return state.squads.teams.find((team) => team.id === id) || state.squads.teams[0];
}

function matchKey(a, b) {
  return [a, b].sort().join(":");
}

function seededMinuteRandom(minute, a, b) {
  return (hash(`${minute}-${a}-${b}`) % 1000) / 1000;
}

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initials(name) {
  return name
    .replace("Canterbury-Bankstown", "Bulldogs")
    .replace("Cronulla-Sutherland", "Sharks")
    .replace("Manly Warringah", "Sea Eagles")
    .replace("St. George Illawarra", "Dragons")
    .split(/\s+/)
    .filter((word) => !["The", "and"].includes(word))
    .slice(-2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
