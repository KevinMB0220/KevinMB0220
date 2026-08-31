#!/usr/bin/env node
/**
 * Builds an animated "XP board" SVG from the real GitHub contribution calendar.
 * The grid fills left-to-right in a wave, the XP bar fills in sync, the counter
 * ticks up, everything holds, then resets. Pure CSS inside the SVG: GitHub
 * strips <script> from READMEs, so animation is the only interactivity available.
 */

const LOGIN = process.env.PROFILE_LOGIN || "KevinMB0220";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_FILE || "assets/xp-grid.svg";
const XP_PER_LEVEL = Number(process.env.XP_PER_LEVEL || 300);

if (!TOKEN) {
  console.error("Missing GH_TOKEN / GITHUB_TOKEN");
  process.exit(1);
}

const QUERY = `
query($login:String!){
  user(login:$login){
    contributionsCollection{
      contributionCalendar{
        totalContributions
        weeks{ firstDay contributionDays{ date contributionCount weekday } }
      }
    }
  }
}`;

// ---------- palette ----------
const BG = "#0b0805";
const EMPTY = "#1b1310";
const RAMP = ["#5a2408", "#9a3412", "#e2620c", "#ff8c1a"];
const HOT = "#ffb35c";
const TEXT = "#f5e6d8";
const MUTED = "#8a7565";
const ACCENT = "#ff8c1a";

// ---------- layout ----------
const CELL = 11, GAP = 2.6, PITCH = CELL + GAP;
const PAD_L = 40, PAD_R = 24;
const GRID_TOP = 104;
const ROWS = 7;

// ---------- animation timing (seconds) ----------
const CYCLE = 11;
const START = 0.4;   // wave begins
const SPAN = 5.4;    // wave crosses the board
const pct = (s) => +((s / CYCLE) * 100).toFixed(3);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function fetchCalendar() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "xp-grid-generator",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user.contributionsCollection.contributionCalendar;
}

function thresholds(days) {
  const nz = days.filter((d) => d.contributionCount > 0).map((d) => d.contributionCount).sort((a, b) => a - b);
  if (!nz.length) return [1, 2, 3, 4];
  const q = (p) => nz[Math.min(nz.length - 1, Math.floor(nz.length * p))];
  // strictly increasing, so four visually distinct tiers always exist
  const raw = [1, q(0.5), q(0.8), q(0.95)];
  return raw.map((v, i) => Math.max(v, i === 0 ? 1 : raw[i - 1] + 1));
}

function levelOf(count, th) {
  if (count <= 0) return 0;
  if (count < th[1]) return 1;
  if (count < th[2]) return 2;
  if (count < th[3]) return 3;
  return 4;
}

function streaks(days) {
  let cur = 0, best = 0, run = 0;
  for (const d of days) {
    if (d.contributionCount > 0) { run++; best = Math.max(best, run); }
    else run = 0;
  }
  // current streak counts back from the end, tolerating an empty final day
  const rev = [...days].reverse();
  let i = 0;
  if (rev.length && rev[0].contributionCount === 0) i = 1;
  for (; i < rev.length; i++) {
    if (rev[i].contributionCount > 0) cur++;
    else break;
  }
  return { cur, best };
}

function monthLabels(weeks) {
  const out = [];
  let last = -1;
  weeks.forEach((w, i) => {
    const d = new Date(w.contributionDays[0].date + "T00:00:00Z");
    const m = d.getUTCMonth();
    if (m !== last && i < weeks.length - 1) {
      out.push({ i, name: d.toLocaleString("en", { month: "short", timeZone: "UTC" }) });
      last = m;
    }
  });
  return out;
}

function build(cal) {
  const weeks = cal.contributionCalendar ? cal.contributionCalendar.weeks : cal.weeks;
  const total = cal.totalContributions;
  const days = weeks.flatMap((w) => w.contributionDays);
  const th = thresholds(days);
  const { cur, best } = streaks(days);
  const active = days.filter((d) => d.contributionCount > 0).length;
  const peak = Math.max(...days.map((d) => d.contributionCount));

  const nWeeks = weeks.length;
  const W = Math.round(PAD_L + nWeeks * PITCH + PAD_R);
  const H = GRID_TOP + ROWS * PITCH + 46;

  const level = Math.floor(total / XP_PER_LEVEL) + 1;
  const into = total % XP_PER_LEVEL;
  const progress = into / XP_PER_LEVEL;
  const toNext = XP_PER_LEVEL - into;

  const barX = PAD_L, barW = W - PAD_L - PAD_R, barY = 56, barH = 11;

  // ----- cells -----
  const cells = [];
  const delays = new Map();
  weeks.forEach((w, wi) => {
    w.contributionDays.forEach((d) => {
      const lv = levelOf(d.contributionCount, th);
      const x = (PAD_L + wi * PITCH).toFixed(1);
      const y = (GRID_TOP + d.weekday * PITCH).toFixed(1);
      const delay = +(START + (wi / Math.max(1, nWeeks - 1)) * SPAN + d.weekday * 0.05).toFixed(2);
      const key = delay.toFixed(2);
      if (!delays.has(key)) delays.set(key, delays.size);
      const cls = `d${delays.get(key)}`;
      const fill = lv === 0 ? EMPTY : RAMP[lv - 1];
      const glow = lv === 4 ? ' filter="url(#glow)"' : "";
      cells.push(
        `<rect class="c ${cls}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${fill}"${glow}><title>${esc(d.date)}: ${d.contributionCount}</title></rect>`
      );
    });
  });

  const delayCss = [...delays.entries()]
    .map(([d, i]) => `.d${i}{animation-delay:${d}s}`)
    .join("");

  // ----- counter steps -----
  const STEPS = 20;
  const p0 = pct(START), p1 = pct(START + SPAN + 0.4);
  const step = (p1 - p0) / STEPS;
  const counters = [];
  const counterCss = [];
  for (let i = 0; i <= STEPS; i++) {
    const val = Math.round((total * i) / STEPS);
    const a = +(p0 + i * step).toFixed(3);
    const b = i === STEPS ? 88 : +(p0 + (i + 1) * step).toFixed(3);
    counters.push(
      `<text class="k k${i}" x="${W - PAD_R}" y="44" text-anchor="end">${val.toLocaleString("en-US")} <tspan fill="${MUTED}">XP</tspan></text>`
    );
    counterCss.push(
      `@keyframes k${i}{0%,${a}%{opacity:0}${(a + 0.01).toFixed(3)}%,${b}%{opacity:1}${(b + 0.01).toFixed(3)}%,100%{opacity:0}}.k${i}{animation-name:k${i}}`
    );
  }

  const months = monthLabels(weeks)
    .map((m) => `<text class="mo" x="${(PAD_L + m.i * PITCH).toFixed(1)}" y="94">${m.name}</text>`)
    .join("");

  const dayNames = [["Mon", 1], ["Wed", 3], ["Fri", 5]]
    .map(([n, r]) => `<text class="mo" x="${PAD_L - 9}" y="${(GRID_TOP + r * PITCH + CELL - 2).toFixed(1)}" text-anchor="end">${n}</text>`)
    .join("");

  const footY = GRID_TOP + ROWS * PITCH + 28;
  const stats = [
    [`${active}`, "active days"],
    [`${cur}`, "day streak"],
    [`${best}`, "best streak"],
    [`${peak}`, "peak day"],
  ];
  let fx = PAD_L;
  const footer = stats
    .map(([v, l]) => {
      const g = `<text class="fv" x="${fx}" y="${footY}">${v}</text><text class="fl" x="${fx + v.length * 8.4 + 6}" y="${footY}">${l}</text>`;
      fx += v.length * 8.4 + 6 + l.length * 5.9 + 22;
      return g;
    })
    .join("");

  const legend = RAMP.map((c, i) => `<rect x="${W - PAD_R - 76 + i * 15}" y="${footY - 9}" width="10" height="10" rx="2" fill="${c}"/>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(LOGIN)} contribution XP board: level ${level}, ${total} contributions">
<title>${esc(LOGIN)} — LEVEL ${level} · ${total.toLocaleString("en-US")} XP</title>
<defs>
  <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#9a3412"/><stop offset=".55" stop-color="${ACCENT}"/><stop offset="1" stop-color="${HOT}"/>
  </linearGradient>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="1.7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="barclip"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}"/></clipPath>
</defs>
<style>
  text{font-family:'Segoe UI',Ubuntu,'Helvetica Neue',Helvetica,Arial,sans-serif}
  .lvl{font-size:21px;font-weight:700;fill:${TEXT};letter-spacing:.5px}
  .lvn{font-size:21px;font-weight:700;fill:${ACCENT}}
  .k{font-size:16px;font-weight:600;fill:${TEXT};font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;animation-duration:${CYCLE}s;animation-timing-function:linear;animation-iteration-count:infinite;animation-fill-mode:both}
  .mo{font-size:10px;fill:${MUTED}}
  .nx{font-size:10.5px;fill:${MUTED}}
  .fv{font-size:13px;font-weight:700;fill:${ACCENT};font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace}
  .fl{font-size:10.5px;fill:${MUTED}}
  .c{transform-box:fill-box;transform-origin:center;animation-name:pop;animation-duration:${CYCLE}s;animation-timing-function:cubic-bezier(.2,.8,.3,1);animation-iteration-count:infinite;animation-fill-mode:both}
  @keyframes pop{
    0%{opacity:0;transform:scale(.15)}
    4%{opacity:1;transform:scale(1.4)}
    8%{opacity:1;transform:scale(1)}
    80%{opacity:1;transform:scale(1)}
    90%{opacity:.22;transform:scale(.8)}
    100%{opacity:0;transform:scale(.15)}
  }
  ${delayCss}
  .fill{animation:fill ${CYCLE}s linear infinite both}
  @keyframes fill{
    0%,${pct(START)}%{width:0}
    ${pct(START + SPAN + 0.4)}%,88%{width:${(barW * progress).toFixed(1)}px}
    96%,100%{width:0}
  }
  .shine{animation:shine ${CYCLE}s linear infinite both}
  @keyframes shine{
    0%,${pct(START)}%{opacity:0;transform:translateX(0)}
    ${pct(START + 1)}%{opacity:.85}
    ${pct(START + SPAN + 0.4)}%{opacity:.85;transform:translateX(${(barW * progress).toFixed(1)}px)}
    ${pct(START + SPAN + 1.2)}%,100%{opacity:0;transform:translateX(${(barW * progress).toFixed(1)}px)}
  }
  .late{animation:late ${CYCLE}s linear infinite both}
  @keyframes late{0%,${pct(START + SPAN)}%{opacity:0}${pct(START + SPAN + 0.9)}%,88%{opacity:1}96%,100%{opacity:0}}
  ${counterCss.join("")}
  @media (prefers-reduced-motion:reduce){
    .c,.fill,.shine,.late,.k{animation:none;opacity:1}
    .fill{width:${(barW * progress).toFixed(1)}px}
    .k{opacity:0}.k${STEPS}{opacity:1}
  }
</style>
<rect width="${W}" height="${H}" rx="12" fill="${BG}"/>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="11.5" fill="none" stroke="#2a1a10"/>

<text class="lvl" x="${PAD_L}" y="44">LEVEL <tspan class="lvn">${level}</tspan></text>
${counters.join("")}

<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#1b1310"/>
<g clip-path="url(#barclip)">
  <rect class="fill" x="${barX}" y="${barY}" height="${barH}" width="0" fill="url(#bar)"/>
  <rect class="shine" x="${barX - 3}" y="${barY}" width="3" height="${barH}" fill="${HOT}"/>
</g>
<text class="nx late" x="${PAD_L}" y="${barY + barH + 15}">${toNext} XP to LEVEL ${level + 1} · ${Math.round(progress * 100)}%</text>
<text class="nx late" x="${W - PAD_R}" y="${barY + barH + 15}" text-anchor="end">last 365 days</text>

${months}
${dayNames}
${cells.join("")}

<g class="late">${footer}${legend}</g>
</svg>
`;
}

const cal = await fetchCalendar();

// A token that cannot read the calendar returns a well-formed but empty
// response. Fail loudly rather than committing a blank board over a good one.
if (!cal.totalContributions || !cal.weeks?.length) {
  console.error(
    `Calendar came back empty for "${LOGIN}" (total=${cal.totalContributions}, ` +
    `weeks=${cal.weeks?.length ?? 0}). The token likely cannot read the ` +
    `contribution calendar — add a GH_PAT secret with the read:user scope.`
  );
  process.exit(1);
}

const svg = build(cal);
const { writeFile, mkdir } = await import("node:fs/promises");
const { dirname } = await import("node:path");
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, svg);
console.log(`wrote ${OUT} (${(svg.length / 1024).toFixed(1)} KB) — ${cal.totalContributions} XP`);
