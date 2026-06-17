// ===============================================================
// Script to generate data/ratings.js with every player pre-populated
// with a single Overall rating.
// Run: node scripts/generate-ratings.js
// ===============================================================

const fs = require("fs");
const path = require("path");

// ── Replicate the exact hash/clamp from app.js ──
function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ── Generate a single Overall rating matching app.js logic ──
function buildOverall(player, teamIndex, playerIndex, teams) {
  const seed = hash(`${player.id}-${teamIndex}-${playerIndex}`);
  const totalPlayers = teams[teamIndex].players.length;
  const tierPosition = playerIndex / totalPlayers;

  let quality;
  if (tierPosition < 0.15) {
    quality = 88 + (seed % 8);        // 88-95  elite
  } else if (tierPosition < 0.35) {
    quality = 78 + (seed % 10);       // 78-87  strong first grader
  } else if (tierPosition < 0.60) {
    quality = 68 + (seed % 10);       // 68-77  solid regular
  } else if (tierPosition < 0.80) {
    quality = 58 + (seed % 10);       // 58-67  rotation / depth
  } else {
    quality = 48 + (seed % 10);       // 48-57  fringe / development
  }

  if (player.squad !== "top30") {
    quality = Math.max(45, quality - (player.squad === "supplementary" ? 8 : 15));
  }

  return quality;
}

// ── Read the squads file ──
const squadsPath = path.join(__dirname, "..", "data", "squads.js");
const squadsContent = fs.readFileSync(squadsPath, "utf-8");

const jsonMatch = squadsContent.match(/window\.NRL_SQUADS\s*=\s*({[\s\S]*?});/);
if (!jsonMatch) {
  console.error("Could not parse squads.js");
  process.exit(1);
}

let squads;
try {
  squads = eval("(" + jsonMatch[1] + ")");
} catch (e) {
  console.error("Failed to parse squads JSON:", e.message);
  process.exit(1);
}

// ── Generate ratings for every player ──
const teams = squads.teams;
const allRatings = {};

teams.forEach((team, teamIndex) => {
  team.players.forEach((player, playerIndex) => {
    allRatings[player.id] = buildOverall(player, teamIndex, playerIndex, teams);
  });
});

// ── Write the output file ──
const lines = [
  "// ===============================================================",
  "// NRL Touchline Manager – Manual Player Ratings Database",
  "// ===============================================================",
  "// Every player has a single Overall rating (OVR).",
  "// To change a player's rating, just edit the number below.",
  "//",
  "// Rating scale: 40-97 (typical NRL player range)",
  "//   90+  elite / rep quality",
  "//   78-89 strong first grader",
  "//   68-77 solid regular",
  "//   58-67 rotation / depth",
  "//   48-57 fringe / development",
  "//   below 48  reserve grade",
  "// ===============================================================",
  "",
  "window.NRL_RATINGS = {",
];

teams.forEach((team) => {
  lines.push(`  // ── ${team.name} ──`);
  team.players.forEach((player) => {
    lines.push(`  "${player.id}": ${allRatings[player.id]},`);
  });
  lines.push("");
});

lines.push("};");
lines.push("");

fs.writeFileSync(path.join(__dirname, "..", "data", "ratings.js"), lines.join("\n"), "utf-8");
console.log(`Generated ratings for ${Object.keys(allRatings).length} players in data/ratings.js`);