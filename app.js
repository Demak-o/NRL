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

const STRATEGY_CARDS = [
  {
    id: "forward-dominance",
    name: "Forward Dominance",
    desc: "+Defence, +Metres",
    modifiers: { defence: 3, metres: 0.08 }
  },
  {
    id: "edge-attack",
    name: "Edge Attack",
    desc: "+Wide tries",
    modifiers: { wideAttack: 0.12 }
  },
  {
    id: "territory-grind",
    name: "Territory Grind",
    desc: "+Kicking game",
    modifiers: { kicking: 4, possession: -0.05 }
  },
  {
    id: "fast-tempo",
    name: "Fast Tempo",
    desc: "-Fatigue risk",
    modifiers: { tempo: 8, fatigue: 0.12 }
  },
  {
    id: "defensive-wall",
    name: "Defensive Wall",
    desc: "+Line speed",
    modifiers: { defence: 5, attack: -2 }
  },
  {
    id: "offload-game",
    name: "Offload Game",
    desc: "+Line breaks",
    modifiers: { attack: 4, errors: 0.08 }
  }
];

const ALL_SLOTS = [
  ...RUN_ON.map(([jersey, role]) => ({ jersey, role, bench: false })),
  ...BENCH.map(([jersey, roles]) => ({ jersey, role: roles[0], roles, bench: true }))
];

const els = {};
const state = {
  squads: window.NRL_SQUADS,
  fixtures: window.NRL_FIXTURES,
  players: [],
  career: null,
  selectedCareerTeam: "",
  phase: "prep",
  style: "balanced",
  running: false,
  timer: null,
  minute: 0,
  ball: { x: 50, y: 50 },
  possession: "home",
  territory: 50,
  match: null,
  ladder: null,
  injuriesCheckedRound: null,
  purchasesThisRound: 0,
  marketSeed: null,
  careerSeed: null,
  triggeredDecisions: new Set()
};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  buildPlayerCatalog();
  bindEvents();
  createLadder();
  renderCareerPicker();
  showCareerModal(true);
  updateSliderLabels();
});

function cacheElements() {
  for (const id of [
    "careerEyebrow", "budgetText", "roundText", "newCareerButton",
    "phasePill", "fixtureCard", "tempoRange", "defenceRange",
    "kickingRange", "benchRange", "speedRange", "tempoValue",
    "defenceValue", "kickingValue", "benchValue", "speedValue",
    "prepView", "pregameView", "matchView", "toPregameButton",
    "autoLineupButton", "toMatchButton", "injuryReport", "lineupEditor",
    "homeCrest", "awayCrest", "homeName", "awayName", "homeScore",
    "awayScore", "matchClock", "matchStatus", "ball", "playersLayer",
    "startButton", "pauseButton", "continueButton",
    "homeMomentum", "awayMomentum", "momentumBar", "statsGrid",
    "commentary", "squadSearch", "marketSearch", "squadList",
    "marketList", "squadCountText", "marketCountText", "ladder",
    "teamRating", "clubCard", "selectedList", "sourcePill",
    "careerModal", "careerTeamGrid", "beginCareerButton"
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.newCareerButton.addEventListener("click", () => {
    pauseMatch();
    state.career = null;
    state.match = null;
    createLadder();
    showCareerModal(true);
  });

  els.beginCareerButton.addEventListener("click", () => {
    if (!state.selectedCareerTeam) return;
    startCareer(state.selectedCareerTeam);
  });

  document.querySelectorAll(".phase-buttons button").forEach((button) => {
    button.addEventListener("click", () => setPhase(button.dataset.phase));
  });

  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.style = button.dataset.style;
      renderAll();
    });
  });

  for (const input of [els.tempoRange, els.defenceRange, els.kickingRange, els.benchRange, els.speedRange].filter(Boolean)) {
    input.addEventListener("input", () => {
      updateSliderLabels();
      restartTimerIfNeeded();
      renderMatchRead();
    });
  }

  els.toPregameButton.addEventListener("click", () => {
    if (isByeWeek()) {
      advanceByeWeek();
      return;
    }
    runInjuryCheck();
    autoPickLineup();
    setPhase("pregame");
  });

  els.autoLineupButton.addEventListener("click", () => {
    autoPickLineup();
    renderPregame();
    renderSelectedList();
  });

  els.toMatchButton.addEventListener("click", () => {
    if (!lineupIsValid()) return;
    resetMatch();
    setPhase("match");
  });

  els.startButton.addEventListener("click", startMatch);
  els.pauseButton.addEventListener("click", pauseMatch);
  els.continueButton.addEventListener("click", continueAfterMatch);
  els.squadSearch.addEventListener("input", renderPrep);
  els.marketSearch.addEventListener("input", renderPrep);
}

function buildPlayerCatalog() {
  state.players = [];
  state.squads.teams.forEach((team, teamIndex) => {
    team.players.forEach((source, playerIndex) => {
      const player = {
        ...source,
        originalTeamId: team.id,
        currentTeamId: team.id,
        injuryUntilRound: 0,
        sold: false
      };
      player.rating = buildRating(player, teamIndex, playerIndex);
      player.talent = buildTalent(player, teamIndex, playerIndex);
      player.value = buildValue(player);
      player.wage = Math.round(player.value * 0.19);
      state.players.push(player);
    });
  });
}

function buildRating(player, teamIndex, playerIndex) {
  // Check for manual rating in data/ratings.js first
  const manualRatings = window.NRL_RATINGS || {};
  if (manualRatings[player.id] != null) {
    return manualRatings[player.id];
  }

  // Auto-generate from roster position (fallback)
  const seed = hash(`${player.id}-${teamIndex}-${playerIndex}`);
  const totalPlayers = state.squads.teams[teamIndex].players.length;
  const tierPosition = playerIndex / totalPlayers;

  let quality;
  if (tierPosition < 0.15) {
    quality = 88 + (seed % 8);
  } else if (tierPosition < 0.35) {
    quality = 78 + (seed % 10);
  } else if (tierPosition < 0.60) {
    quality = 68 + (seed % 10);
  } else if (tierPosition < 0.80) {
    quality = 58 + (seed % 10);
  } else {
    quality = 48 + (seed % 10);
  }

  if (player.squad !== "top30") {
    quality = Math.max(45, quality - (player.squad === "supplementary" ? 8 : 15));
  }

  return quality;
}

function buildTalent(player, teamIndex, playerIndex) {
  const seed = hash(`${player.name}-talent-${teamIndex}-${playerIndex}`);
  return clamp(Math.round(player.rating + 3 + (seed % 18)), 40, 99);
}

function buildValue(player) {
  const premium = Math.pow(Math.max(0, player.rating - 52), 2) * 1250;
  const talent = Math.max(0, player.talent - player.rating) * 30000;
  const spine = player.positions.some((pos) => ["FB", "FE", "HB", "HK"].includes(pos)) ? 90000 : 0;
  return roundMoney(100000 + premium + talent + spine);
}

function renderCareerPicker() {
  state.selectedCareerTeam = state.squads.teams[0].id;
  els.careerTeamGrid.innerHTML = state.squads.teams.map((team, index) => `
    <button class="career-team ${index === 0 ? "selected" : ""}" data-team="${team.id}" type="button">
      <span class="mini-crest" style="background:linear-gradient(135deg, ${team.primary}, ${team.secondary})" data-crest="${team.id}">${initials(team.name)}</span>
      <strong>${team.name}</strong>
    </button>
  `).join("");
  els.careerTeamGrid.querySelectorAll(".career-team").forEach((button) => {
    button.addEventListener("click", () => {
      els.careerTeamGrid.querySelectorAll(".career-team").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      state.selectedCareerTeam = button.dataset.team;
    });
  });
  // Try loading logo images into mini-crests
  els.careerTeamGrid.querySelectorAll("[data-crest]").forEach(loadMiniCrest);
}

function loadMiniCrest(el) {
  const teamId = el.dataset.crest;
  const team = state.squads.teams.find((t) => t.id === teamId);
  if (!team) return;
  const img = new Image();
  img.onload = () => {
    el.innerHTML = "";
    el.style.background = "transparent";
    el.style.border = "none";
    el.style.textShadow = "none";
    el.appendChild(img);
  };
  img.onerror = () => {
    // Keep the initials fallback already rendered
  };
  img.src = logoPath(teamId);
  img.alt = team.shortName;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
}

function showCareerModal(show) {
  els.careerModal.classList.toggle("hidden", !show);
}

function startCareer(teamId) {
  state.players.forEach((player) => {
    player.currentTeamId = player.originalTeamId;
    player.injuryUntilRound = 0;
    player.sold = false;
  });
  const initialRoster = state.players.filter((player) => player.originalTeamId === teamId).map((player) => player.id);
  state.career = {
    teamId,
    seed: `${teamId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    budget: 3000000,
    roundIndex: 0,
    rosterIds: initialRoster,
    lineup: [],
    injuryLog: [],
    results: []
  };
  state.phase = "prep";
  state.injuriesCheckedRound = null;
  createLadder();
  autoPickLineup();
  showCareerModal(false);
  renderAll();
}

function setPhase(phase) {
  if (!state.career) return;
  if (phase === "match" && !state.match && !isByeWeek()) {
    if (!lineupIsValid()) autoPickLineup();
    resetMatch();
  }
  state.phase = phase;
  document.querySelectorAll(".phase-buttons button").forEach((button) => {
    button.classList.toggle("active", button.dataset.phase === phase);
  });
  for (const id of ["prepView", "pregameView", "matchView"]) {
    els[id].classList.toggle("active", id === `${phase}View`);
  }
  els.phasePill.textContent = phase === "pregame" ? "Pregame" : phase === "match" ? "Game" : "Prep";
  renderMatch();
  renderAll();
}

function renderAll() {
  if (!state.career) return;
  renderHeader();
  renderFixture();
  renderPrep();
  renderPregame();
  renderMatch();
  renderLadder();
  renderClubStatus();
  renderSelectedList();
}

function renderHeader() {
  const team = careerTeam();
  els.careerEyebrow.textContent = `${team.name} career`;
  els.budgetText.textContent = money(state.career.budget);
  els.roundText.textContent = String(currentRound().round);
  const totalPlayers = state.squads.teams.reduce((total, item) => total + item.players.length, 0);
  els.sourcePill.textContent = `${state.squads.season} squads (${totalPlayers} players) and ${state.fixtures.season} fixtures. Ratings, money and injuries are game-generated.`;
}

function renderFixture() {
  const fixture = currentTeamFixture();
  const round = currentRound();
  if (!fixture) {
    els.fixtureCard.innerHTML = `
      <span>${round.label} • ${round.dateRange}</span>
      <strong>Bye week</strong>
      <p>Recover, trade, and prepare for the next round.</p>
    `;
    els.toPregameButton.textContent = "Advance Bye";
    return;
  }
  const home = teamById(fixture.home);
  const away = teamById(fixture.away);
  els.fixtureCard.innerHTML = `
    <span>${round.label} • ${round.dateRange}</span>
    <strong>${home.shortName} v ${away.shortName}</strong>
    <p>${fixture.date || "Date TBA"}${fixture.venue ? ` • ${fixture.venue}` : ""}</p>
  `;
  els.toPregameButton.textContent = "Go To Pregame";
}

function renderPrep() {
  const squadQuery = els.squadSearch.value.trim().toLowerCase();
  const marketQuery = els.marketSearch.value.trim().toLowerCase();
  const roster = careerRoster()
    .filter((player) => playerMatches(player, squadQuery))
    .sort((a, b) => b.rating - a.rating || b.talent - a.talent);
  const market = marketPlayers()
    .filter((player) => playerMatches(player, marketQuery))
    .slice(0, 120);

  els.squadCountText.textContent = `${careerRoster().length} players`;
  els.marketCountText.textContent = `${marketPlayers().length} available`;
  els.squadList.innerHTML = roster.map((player) => playerRow(player, "sell")).join("");
  els.marketList.innerHTML = market.map((player) => playerRow(player, "buy")).join("");
  bindMarketButtons();
}

function playerRow(player, mode) {
  const team = teamById(player.originalTeamId);
  const injured = isInjured(player);
  const disabledSell = mode === "sell" && careerRoster().length <= 17;
  const disabledBuy = mode === "buy" && state.career.budget < player.value;
  const action = mode === "sell" ? "Sell" : "Recruit";
  return `
    <div class="player-row ${injured ? "injured" : ""}">
      <div class="player-main">
        <b>${escapeHtml(player.name)}</b>
        <span>${player.positions.join("/")} • OVR ${player.rating} • TAL ${player.talent} • ${team.shortName}</span>
        ${injured ? `<em>Injured until R${player.injuryUntilRound}</em>` : ""}
      </div>
      <div class="player-money">
        <strong>${money(player.value)}</strong>
        <button data-action="${mode}" data-player="${player.id}" ${disabledSell || disabledBuy ? "disabled" : ""} type="button">${action}</button>
      </div>
    </div>
  `;
}

function bindMarketButtons() {
  document.querySelectorAll("[data-action='buy']").forEach((button) => {
    button.addEventListener("click", () => recruitPlayer(button.dataset.player));
  });
  document.querySelectorAll("[data-action='sell']").forEach((button) => {
    button.addEventListener("click", () => sellPlayer(button.dataset.player));
  });
}

function recruitPlayer(playerId) {
  const player = playerById(playerId);
  if (!player || state.career.rosterIds.includes(playerId) || state.career.budget < player.value) return;
  if (state.purchasesThisRound >= 2) {
    alert("Transfer limit: max 2 purchases per round");
    return;
  }
  state.career.budget -= player.value;
  player.currentTeamId = state.career.teamId;
  state.career.rosterIds.push(playerId);
  state.purchasesThisRound += 1;
  renderAll();
}

function sellPlayer(playerId) {
  if (careerRoster().length <= 17) return;
  const player = playerById(playerId);
  state.career.rosterIds = state.career.rosterIds.filter((id) => id !== playerId);
  state.career.budget += Math.round(player.value * 0.72);
  player.currentTeamId = player.originalTeamId;
  player.sold = true;
  state.career.lineup = state.career.lineup.filter((slot) => slot.playerId !== playerId);
  renderAll();
}

function runInjuryCheck() {
  const roundNo = currentRound().round;
  if (state.injuriesCheckedRound === roundNo) return;
  const log = [];
  careerRoster().forEach((player) => {
    if (isInjured(player)) return;
    const risk = 0.02 + (78 - player.rating) / 2200;
    const roll = seededRandom(`${state.career.seed}-r${roundNo}-${player.id}-injury`);
    if (roll < risk) {
      const weeks = 1 + Math.floor(seededRandom(`${state.career.seed}-${player.id}-${roundNo}-weeks`) * 4);
      player.injuryUntilRound = roundNo + weeks;
      log.push(`${player.name}: ${weeks} week${weeks > 1 ? "s" : ""}`);
    }
  });
  state.career.injuryLog = log.length ? log : ["No new injuries in the final run."];
  state.injuriesCheckedRound = roundNo;
}

function renderPregame() {
  els.injuryReport.innerHTML = (state.career.injuryLog.length ? state.career.injuryLog : ["Run the prep stage to check injuries."])
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("");

  els.lineupEditor.innerHTML = ALL_SLOTS.map((slot, index) => {
    const selected = state.career.lineup[index]?.playerId || "";
    const takenElsewhere = new Set(state.career.lineup.map((s, i) => i === index ? "" : s?.playerId).filter(Boolean));
    const options = healthyRoster()
      .filter((player) => !takenElsewhere.has(player.id) || player.id === selected)
      .sort((a, b) => scoreForRole(b, slot.role, getHumanTactic()) - scoreForRole(a, slot.role, getHumanTactic()))
      .map((player) => `<option value="${player.id}" ${player.id === selected ? "selected" : ""}>${player.name} • ${player.positions.join("/")}</option>`)
      .join("");
    return `
      <label class="lineup-slot">
        <span>${slot.jersey}</span>
        <strong>${slot.bench ? "Bench" : POSITIONS[slot.role]}</strong>
        <select data-slot="${index}" aria-label="${slot.jersey} ${POSITIONS[slot.role]}">
          <option value="">Unpicked</option>
          ${options}
        </select>
      </label>
    `;
  }).join("");
  els.lineupEditor.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", () => {
      const index = Number(select.dataset.slot);
      state.career.lineup[index] = {
        ...ALL_SLOTS[index],
        playerId: select.value
      };
      renderPregame();
      renderSelectedList();
    });
  });
}

function autoPickLineup() {
  const selected = new Set();
  state.career.lineup = ALL_SLOTS.map((slot) => {
    const roles = slot.roles || [slot.role];
    const player = bestForRole(healthyRoster(), roles, selected, getHumanTactic());
    if (player) selected.add(player.id);
    return { ...slot, playerId: player?.id || "" };
  });
}

function lineupIsValid() {
  const picked = state.career.lineup.map((slot) => slot?.playerId).filter(Boolean);
  return picked.length === 17 && new Set(picked).size === 17;
}

function renderMatch() {
  if (!state.match) return;
  const { home, away, score } = state.match;
  els.homeName.textContent = home.name;
  els.awayName.textContent = away.name;
  els.homeScore.textContent = score.home;
  els.awayScore.textContent = score.away;
  els.matchClock.textContent = `${state.minute}'`;
  renderCrest(els.homeCrest, home);
  renderCrest(els.awayCrest, away);
  renderPitch();
  renderMatchRead();
  els.continueButton.disabled = state.minute < 80;
}

function resetMatch() {
  const fixture = currentTeamFixture();
  if (!fixture) return;
  const homeTeam = buildMatchTeam(teamById(fixture.home), fixture.home === state.career.teamId);
  const awayTeam = buildMatchTeam(teamById(fixture.away), fixture.away === state.career.teamId);
  state.minute = 0;
  state.running = false;
  state.possession = "home";
  state.territory = 50;
  state.ball = { x: 50, y: 50 };
  state.triggeredDecisions = new Set();
  state.match = {
    home: homeTeam,
    away: awayTeam,
    managerSide: fixture.home === state.career.teamId ? "home" : "away",
    score: { home: 0, away: 0 },
    stats: { home: blankStats(), away: blankStats() },
    events: [{ minute: 0, text: `${homeTeam.shortName} and ${awayTeam.shortName} are set.` }],
    finished: false,
    decisionModifiers: { defence: 0, attack: 0, kicking: 0, tempo: 0, fatigue: 0, metres: 0, wideAttack: 0, possession: 0, errors: 0, territory: 0 }
  };
  els.matchStatus.textContent = "Ready";
}

function buildMatchTeam(team, managed) {
  const tactic = managed ? getHumanTactic() : getOpponentTactic(team);
  const lineup = managed ? lineupFromCareer(team, tactic) : autoLineupForTeam(team, tactic);
  return {
    ...team,
    tactic,
    runOn: lineup.runOn,
    bench: lineup.bench,
    rating: lineup.rating,
    usedBench: new Set()
  };
}

function lineupFromCareer(team, tactic) {
  const runOn = state.career.lineup.slice(0, 13).map((slot) => ({
    ...slot,
    player: playerById(slot.playerId),
    fatigue: 0
  }));
  const bench = state.career.lineup.slice(13).map((slot) => ({
    ...slot,
    player: playerById(slot.playerId),
    fatigue: 0
  }));
  return { runOn, bench, rating: teamRating([...runOn, ...bench], tactic) };
}

function autoLineupForTeam(team, tactic) {
  const selected = new Set();
  const source = team.players.map((player) => playerById(player.id)).filter(Boolean);
  const runOn = RUN_ON.map(([jersey, role]) => {
    const player = bestForRole(source, [role], selected, tactic);
    selected.add(player.id);
    return { jersey, role, player, fatigue: 0 };
  });
  const bench = BENCH.map(([jersey, roles]) => {
    const player = bestForRole(source, roles, selected, tactic);
    selected.add(player.id);
    return { jersey, role: roles[0], roles, player, fatigue: 0 };
  });
  return { runOn, bench, rating: teamRating([...runOn, ...bench], tactic) };
}

function bestForRole(players, roles, selected, tactic) {
  const pool = players.filter((player) => player && !selected.has(player.id) && !isInjured(player));
  return pool.sort((a, b) => {
    const role = roles[0];
    const aFit = roles.some((code) => a.positions.includes(code)) ? 18 : 0;
    const bFit = roles.some((code) => b.positions.includes(code)) ? 18 : 0;
    return scoreForRole(b, role, tactic) + bFit - (scoreForRole(a, role, tactic) + aFit);
  })[0] || players.find((player) => !selected.has(player.id));
}

function scoreForRole(player, role, tactic) {
  const fit = player.positions.includes(role) ? 10 : 0;
  const tempoBoost = tactic.tempo > 65 ? player.rating * 0.1 : 0;
  return player.rating + fit + tempoBoost;
}

function teamRating(lineup, tactic) {
  return Math.round(lineup.reduce((total, item) => total + scoreForRole(item.player, item.role, tactic), 0) / lineup.length);
}

function startMatch() {
  if (!state.match) resetMatch();
  if (state.minute >= 80) return;
  state.running = true;
  els.matchStatus.textContent = "Live";
  restartTimerIfNeeded();
}

function pauseMatch() {
  state.running = false;
  clearInterval(state.timer);
  state.timer = null;
  if (els.matchStatus && state.match && !state.match.finished) els.matchStatus.textContent = "Paused";
}

function restartTimerIfNeeded() {
  if (!state.running) return;
  clearInterval(state.timer);
  state.timer = setInterval(tickMatch, Math.max(140, (400 - Number(els.speedRange.value) * 60) * 2));
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
  const attackMods = getStrategyModifiers(attack);
  const defendMods = getStrategyModifiers(defend);
  const decisionMods = attackKey === state.match.managerSide ? state.match.decisionModifiers : { defence: 0, attack: 0, kicking: 0, tempo: 0, fatigue: 0, metres: 0, wideAttack: 0, possession: 0, errors: 0, territory: 0 };

  const pressure = teamPressure(attack, defend, defendMods);
  const rand = seededRandom(`${state.minute}-${attack.id}-${defend.id}`);
  const carry = 5 + Math.round((pressure - 50) / 12) + Math.round(((attack.tactic.tempo + attackMods.tempo + decisionMods.tempo) - 50) / 20);
  state.territory = clamp(state.territory + carry + (attackMods.territory || 0) + (decisionMods.territory || 0), 5, 95);
  state.ball.x = attackKey === "home" ? clamp(state.territory + (rand - 0.5) * 2, 8, 92) : clamp(100 - state.territory + (rand - 0.5) * 2, 8, 92);
  state.ball.y = clamp(48 + (rand - 0.5) * 36, 18, 82);
  state.match.stats[attackKey].meters += Math.max(18, Math.round(pressure * 0.9 + rand * (35 + ((attackMods.metres || 0) + (decisionMods.metres || 0)) * 100)));
  state.match.stats[defendKey].tackles += Math.round((5 + Math.floor(rand * 4)) * (1 + (defendMods.defence + decisionMods.defence) * 0.02));

  const eventRoll = rand * 100 + pressure * 0.12;
  const errorMod = (attack.tactic.tempo - 50) / 8 + ((attackMods.errors || 0) + (decisionMods.errors || 0)) * 20;
  const tryMod = ((attackMods.wideAttack || 0) + (decisionMods.wideAttack || 0)) * 0.8;

  if (eventRoll > 96 + tryMod && state.territory > 78) {
    scoreTry(attackKey, attack, pressure, rand);
  } else if (eventRoll > 88 && state.minute > 8) {
    lineBreak(attackKey, attack);
  } else if (eventRoll < 10 + errorMod) {
    errorEvent(attackKey, defendKey, attack);
  } else if (eventRoll > 78 && (attack.tactic.kicking + attackMods.kicking + decisionMods.kicking) > 58 && state.minute > 20) {
    kickEvent(attackKey, defendKey, attack);
  } else if (state.minute % 6 === 0) {
    setRestartEvent(attackKey, attack);
  }
}

function scoreTry(side, team, pressure, rand) {
  const scorer = chooseScorer(team, rand);
  const converted = rand + teamAverage(team) / 140 > 0.78;
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
  const player = chooseScorer(team, seededRandom(`${state.minute + 7}-${team.id}-break`));
  state.match.stats[side].lineBreaks += 1;
  state.match.events.unshift({ minute: state.minute, text: `${player.name} breaks the line for ${team.shortName}.` });
  state.territory = clamp(state.territory + 14, 5, 95);
}

function errorEvent(attackKey, defendKey, team) {
  state.match.stats[attackKey].errors += 1;
  state.match.events.unshift({ minute: state.minute, text: `${team.shortName} lose shape and turn it over.` });
  state.possession = defendKey;
  state.territory = clamp(100 - state.territory, 18, 82);
}

function kickEvent(attackKey, defendKey, team) {
  const kicker = bestKicker(team);
  const pinned = team.tactic.kicking + teamAverage(team) > 132;
  state.match.events.unshift({ minute: state.minute, text: `${kicker.name} kicks ${pinned ? "deep into the corner" : "early for territory"}.` });
  state.possession = defendKey;
  state.territory = pinned ? 16 : 34;
}

function setRestartEvent(side, team) {
  state.match.stats[side].completions += 1;
  state.match.events.unshift({ minute: state.minute, text: `${team.shortName} complete the set and keep the pressure on.` });
}

function finishMatch() {
  pauseMatch();
  state.minute = 80;
  state.match.finished = true;
  els.matchStatus.textContent = "Full time";
  const score = state.match.score;
  const home = state.match.home.shortName;
  const away = state.match.away.shortName;
  const result = score.home === score.away ? "It ends level." : score.home > score.away ? `${home} win.` : `${away} win.`;
  state.match.events.unshift({ minute: 80, text: `Full time: ${home} ${score.home}, ${away} ${score.away}. ${result}` });
  applyRoundResults(score.home, score.away);
  renderAll();
}

function applyRoundResults(managedHomeScore, managedAwayScore) {
  const round = currentRound();
  if (state.career.results.some((result) => result.round === round.round)) return;
  const fixture = currentTeamFixture();
  round.matches.forEach((match) => {
    let homeScore;
    let awayScore;
    if (fixture && match.home === fixture.home && match.away === fixture.away) {
      homeScore = managedHomeScore;
      awayScore = managedAwayScore;
    } else {
      const simulated = simResult(teamById(match.home), teamById(match.away), round.round);
      homeScore = simulated.home;
      awayScore = simulated.away;
    }
    applyLadderResult(match.home, match.away, homeScore, awayScore);
  });
  state.career.results.push({ round: round.round });
}

function continueAfterMatch() {
  if (!state.match?.finished) return;
  nextRound();
}

function advanceByeWeek() {
  const round = currentRound();
  if (!state.career.results.some((result) => result.round === round.round)) {
    round.matches.forEach((match) => {
      const simulated = simResult(teamById(match.home), teamById(match.away), round.round);
      applyLadderResult(match.home, match.away, simulated.home, simulated.away);
    });
    state.career.results.push({ round: round.round });
  }
  nextRound();
}

function nextRound() {
  state.career.roundIndex = Math.min(state.career.roundIndex + 1, state.fixtures.rounds.length - 1);
  state.career.injuryLog = [];
  state.injuriesCheckedRound = null;
  state.match = null;
  state.minute = 0;
  state.ball = { x: 50, y: 50 };
  state.purchasesThisRound = 0;
  state.marketSeed = null;
  state.triggeredDecisions = new Set();
  recoverInjuries();
  setPhase("prep");
}

function recoverInjuries() {
  const roundNo = currentRound().round;
  careerRoster().forEach((player) => {
    if (player.injuryUntilRound <= roundNo) player.injuryUntilRound = 0;
  });
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

function renderPitch() {
  const home = state.match.home;
  const away = state.match.away;
  els.ball.style.left = `${state.ball.x}%`;
  els.ball.style.top = `${state.ball.y}%`;
  const dots = [];
  home.runOn.forEach((item, index) => {
    const spot = tacticalSpot(index, "home");
    dots.push(playerDot(item, home, spot.x, spot.y, ""));
  });
  away.runOn.forEach((item, index) => {
    const spot = tacticalSpot(index, "away");
    dots.push(playerDot(item, away, spot.x, spot.y, "away"));
  });
  els.playersLayer.innerHTML = dots.join("");
}

function tacticalSpot(index, side) {
  const attacking = state.possession === side;
  const direction = side === "home" ? -1 : 1;
  const ballX = state.ball.x;
  const ballY = state.ball.y;
  const lane = [50, 22, 36, 64, 78, 42, 58, 45, 52, 59, 37, 67, 50][index];
  const attackOffsets = [-18, -9, -6, -6, -9, -4, -2, 2, 0, 3, 6, 6, 4];
  const defenceLine = ballX + direction * 10;
  const x = attacking ? ballX + direction * attackOffsets[index] : defenceLine + direction * Math.min(index % 5, 2);
  const spread = attacking ? (lane - 50) * 0.84 : (lane - 50) * 0.94;
  const y = ballY + spread;

  const drift = seededRandom(`drift-${side}-${index}-${Math.floor(state.minute / 2)}`);
  const driftX = (drift - 0.5) * 3.5;
  const driftY = (seededRandom(`drift-y-${side}-${index}-${state.minute}`) - 0.5) * 4.2;

  return {
    x: clamp(x + driftX, 6, 94),
    y: clamp(y + driftY, 9, 91)
  };
}

function playerDot(item, team, x, y, extraClass) {
  const bg = team.primary;
  const textColor = team.secondary;
  const borderColor = team.secondary;
  const shadow = "0 6px 14px rgba(0,0,0,0.5)";
  return `<div class="player-dot ${extraClass}" title="${escapeHtml(item.player.name)}" style="left:${x}%;top:${y}%;background:${bg};color:${textColor};border-color:${borderColor};box-shadow:${shadow}">${item.jersey}</div>`;
}

function renderMatchRead() {
  if (!state.match) return;
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
    ["Possession", state.possession === "home" ? state.match.home.shortName : state.match.away.shortName],
    ["Territory", `${Math.round(state.territory)}m`],
    ["Meters", `${stats.home.meters}-${stats.away.meters}`],
    ["Line breaks", `${stats.home.lineBreaks}-${stats.away.lineBreaks}`],
    ["Errors", `${stats.home.errors}-${stats.away.errors}`],
    ["Tackles", `${stats.home.tackles}-${stats.away.tackles}`]
  ].map(([label, value]) => `<div class="stat-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  els.commentary.innerHTML = state.match.events.slice(0, 12).map((event) => `<li><b>${event.minute}'</b> ${escapeHtml(event.text)}</li>`).join("");
}

function renderClubStatus() {
  const team = careerTeam();
  const roster = careerRoster();
  const avg = Math.round(roster.reduce((total, player) => total + player.rating, 0) / roster.length);
  const talent = Math.round(roster.reduce((total, player) => total + player.talent, 0) / roster.length);
  els.teamRating.textContent = `${avg} OVR`;
  els.clubCard.innerHTML = `
    <div class="club-banner" style="background:linear-gradient(135deg, ${team.primary}, ${team.secondary})">
      <span class="club-logo" data-crest="${team.id}">${initials(team.name)}</span>
      <strong>${team.name}</strong>
    </div>
    <div class="club-metrics">
      <span>Squad <b>${roster.length}</b></span>
      <span>Talent <b>${talent}</b></span>
      <span>Injured <b>${roster.filter(isInjured).length}</b></span>
    </div>
  `;
  // Try loading logo into club banner
  const logoEl = els.clubCard.querySelector(".club-logo");
  if (logoEl) loadMiniCrest(logoEl);
}

function renderSelectedList() {
  const slots = state.career?.lineup || [];
  els.selectedList.innerHTML = slots.map((slot) => {
    const player = playerById(slot.playerId);
    return `
      <div class="lineup-item">
        <div class="jersey" style="background:${careerTeam().primary}">${slot.jersey}</div>
        <div>
          <b>${player ? escapeHtml(player.name) : "Unpicked"}</b>
          <span>${slot.role} ${player ? `• OVR ${player.rating}` : ""}</span>
        </div>
        <strong>${player ? player.positions.join("/") : "--"}</strong>
      </div>
    `;
  }).join("");
}

function createLadder() {
  state.ladder = Object.fromEntries(state.squads.teams.map((team) => [team.id, {
    teamId: team.id,
    played: 0,
    points: 0,
    for: 0,
    against: 0
  }]));
}

function applyLadderResult(homeId, awayId, homeScore, awayScore) {
  const home = state.ladder[homeId];
  const away = state.ladder[awayId];
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
}

function renderLadder() {
  if (!state.ladder) return;
  const rows = Object.values(state.ladder)
    .sort((a, b) => b.points - a.points || (b.for - b.against) - (a.for - a.against) || b.for - a.for);
  els.ladder.innerHTML = rows.map((row, index) => {
    const team = teamById(row.teamId);
    return `<div class="ladder-row"><span>${index + 1}</span><b>${team.shortName}</b><span>${row.played}</span><strong>${row.points}</strong></div>`;
  }).join("");
}

function simResult(home, away, roundNo) {
  const h = teamPower(buildMatchTeamForSim(home));
  const a = teamPower(buildMatchTeamForSim(away));
  const spread = clamp(Math.round((h - a) / 5), -18, 18);
  const base = 12 + (hash(`${state.career.seed}-${home.id}-${away.id}-${roundNo}`) % 20);
  return {
    home: Math.max(0, base + spread + (hash(`${state.career.seed}-${home.id}`) % 8)),
    away: Math.max(0, base - spread + (hash(`${state.career.seed}-${away.id}`) % 8))
  };
}

function buildMatchTeamForSim(team) {
  const tactic = getOpponentTactic(team);
  const lineup = autoLineupForTeam(team, tactic);
  return { ...team, tactic, runOn: lineup.runOn, bench: lineup.bench };
}

function currentRound() {
  return state.fixtures.rounds[state.career?.roundIndex || 0];
}

function currentTeamFixture() {
  const teamId = state.career.teamId;
  return currentRound().matches.find((match) => match.home === teamId || match.away === teamId);
}

function isByeWeek() {
  return !currentTeamFixture();
}

function careerTeam() {
  return teamById(state.career.teamId);
}

function careerRoster() {
  return state.career.rosterIds.map(playerById).filter(Boolean);
}

function healthyRoster() {
  return careerRoster().filter((player) => !isInjured(player));
}

function marketPlayers() {
  if (!state.marketSeed) {
    state.marketSeed = seededRandom(`market-${state.career.seed}-market-${state.career.roundIndex}`);
  }
  const owned = new Set(state.career.rosterIds);
  const available = state.players.filter((player) => !owned.has(player.id));

  const weighted = available.map((player) => {
    const rarity = Math.pow((player.rating - 48) / 48, 3.5);
    const chance = Math.pow(1 - rarity, 2);
    return { player, chance };
  });

  const selected = [];
  const sorted = weighted.sort(() => 0.5 - seededRandom(`${state.marketSeed}-sort-${selected.length}`));

  for (let i = 0; i < sorted.length && selected.length < 6; i++) {
    const roll = seededRandom(`${state.marketSeed}-roll-${i}`);
    if (roll < sorted[i].chance) {
      selected.push(sorted[i].player);
    }
  }

  return selected.sort((a, b) => b.rating - a.rating || b.talent - a.talent);
}

function playerMatches(player, query) {
  if (!query) return true;
  return player.name.toLowerCase().includes(query) || player.positions.join(" ").toLowerCase().includes(query) || teamById(player.originalTeamId).name.toLowerCase().includes(query);
}

function isInjured(player) {
  return player.injuryUntilRound > currentRound().round;
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

function getStrategyModifiers(team) {
  return { defence: 0, attack: 0, kicking: 0, tempo: 0, fatigue: 0, metres: 0, wideAttack: 0, possession: 0, errors: 0, territory: 0 };
}

function getOpponentTactic(team) {
  const seed = hash(`${state.career.seed}-${team.id}`);
  return {
    style: ["balanced", "expansive", "territory"][seed % 3],
    tempo: 45 + (seed % 32),
    defence: 45 + ((seed >> 2) % 34),
    kicking: 44 + ((seed >> 4) % 38),
    benchMinute: 35 + ((seed >> 6) % 24)
  };
}

function blankStats() {
  return { meters: 0, lineBreaks: 0, errors: 0, tackles: 0, tries: 0, completions: 0 };
}

function teamPower(team) {
  const avgRating = teamAverage(team);
  const styleBoost = team.tactic.style === "expansive" ? 4 : team.tactic.style === "territory" ? 4 : 0;
  const tempoMod = (team.tactic.tempo - 50) / 8;
  const defenceMod = (team.tactic.defence - 50) / 7;
  const kickingMod = (team.tactic.kicking - 50) / 9;
  const fatigue = team.runOn.reduce((total, item) => total + (item.fatigue || 0), 0) / team.runOn.length;
  return (avgRating + styleBoost + tempoMod + defenceMod + kickingMod) - fatigue * 0.35;
}

function teamPressure(attack, defend, defendMods) {
  const defendPower = teamPower(defend) + (defendMods?.defence || 0) * 0.3;
  return clamp(50 + teamPower(attack) - defendPower, 15, 88);
}

function teamAverage(team) {
  return team.runOn.reduce((total, item) => total + item.player.rating, 0) / team.runOn.length;
}

function chooseScorer(team, rand) {
  const backs = team.runOn.filter((item) => ["FB", "WG", "CE", "FE", "HB"].includes(item.role));
  const pool = rand > 0.28 ? backs : team.runOn;
  return pool[Math.floor(rand * pool.length)]?.player || team.runOn[0].player;
}

function bestKicker(team) {
  return [...team.runOn].sort((a, b) => b.player.rating - a.player.rating)[0].player;
}

function logoPath(teamId) {
  return `logos/${teamId}.png`;
}

function renderCrest(el, team) {
  const img = new Image();
  img.onload = () => {
    el.innerHTML = "";
    el.style.background = "transparent";
    el.style.border = "none";
    el.style.textShadow = "none";
    el.appendChild(img);
  };
  img.onerror = () => {
    el.textContent = initials(team.name);
    el.style.background = `linear-gradient(135deg, ${team.primary}, ${team.secondary})`;
    el.style.border = "";
    el.style.textShadow = "";
  };
  img.src = logoPath(team.id);
  img.alt = team.shortName;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
}

function updateSliderLabels() {
  if (els.tempoValue && els.tempoRange) els.tempoValue.textContent = els.tempoRange.value;
  if (els.defenceValue && els.defenceRange) els.defenceValue.textContent = els.defenceRange.value;
  if (els.kickingValue && els.kickingRange) els.kickingValue.textContent = els.kickingRange.value;
  if (els.benchValue && els.benchRange) els.benchValue.textContent = `${els.benchRange.value}'`;
  if (els.speedValue && els.speedRange) els.speedValue.textContent = `${els.speedRange.value}x`;
}

function teamById(id) {
  return state.squads.teams.find((team) => team.id === id) || state.squads.teams[0];
}

function playerById(id) {
  return state.players.find((player) => player.id === id);
}

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  return (hash(seed) % 1000) / 1000;
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

function money(value) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}m`;
  return `$${Math.round(value / 1000)}k`;
}

function roundMoney(value) {
  return Math.round(value / 10000) * 10000;
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
