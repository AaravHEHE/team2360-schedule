// Builds dist/index.html: a fully static page with all VEX data baked in.
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://events.vex.com/api/v2';
const TOKEN = process.env.VEX_TOKEN;
if (!TOKEN) { console.error('VEX_TOKEN is not set'); process.exit(1); }

const PREFIX = '2360';
const TEAMS = ['2360A', '2360C', '2360D', '2360H', '2360N', '2360S', '2360V', '2360X'];
const EVENTS = [
  { key: 'ipsd', name: 'IPSD League', date: '2026-10-23', venue: 'Neuqua Valley HS', sku: 'VE-V5-26-66342', teams: TEAMS },
  { key: 'lakepark', name: 'Lake Park', date: '2026-10-24', venue: 'Lake Park HS, Roselle', sku: 'RE-V5RC-26-4295', teams: ['2360A', '2360C', '2360D', '2360H', '2360N', '2360X'] },
  { key: 'clash1', name: 'Cornfield Clash 1', date: '2026-11-07', venue: 'Siebel Center, Champaign', sku: 'RE-V5RC-26-4351', teams: ['2360A', '2360C', '2360H', '2360N', '2360S', '2360V'] },
  { key: 'gl2', name: 'Great Lakes 2', date: '2027-01-03', venue: 'Batavia High School', sku: 'RE-V5RC-26-5015', teams: ['2360D', '2360H', '2360S', '2360V', '2360X'] },
  { key: 'clash2', name: 'Cornfield Clash 2', date: '2027-01-30', venue: 'Siebel Center, Champaign', sku: 'RE-V5RC-26-4756', teams: ['2360A', '2360C', '2360D', '2360S', '2360V', '2360X'] },
  { key: 'lockport', name: 'Lockport', date: '2027-02-06', venue: 'Lockport Township HS East', sku: 'RE-V5RC-26-4977', teams: TEAMS },
  { key: 'glskills', name: 'Great Lakes Skills', date: '2027-02-28', venue: 'Rotolo MS, Batavia', sku: 'RE-V5RC-26-5017', teams: TEAMS },
  { key: 'state', name: 'State Championship', date: '2027-03-12', venue: 'Waubonsee CC, Sugar Grove', sku: 'RE-V5RC-26-5018', teams: [] }
];

let calls = 0, failures = 0;
async function api(path) {
  calls++;
  try {
    const res = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()).data || [];
  } catch (err) {
    failures++;
    console.warn('Failed', path, String(err));
    return [];
  }
}

const ours = t => String((t && t.name) || '').startsWith(PREFIX);
function skillType(t) {
  const s = String(t).toLowerCase();
  if (s === 'driver' || s === '1') return 'Driver';
  if (['programming', 'auto', 'autonomous', '0'].includes(s)) return 'Programming';
  if (s === 'combined' || s === '2') return 'Combined';
  return String(t);
}

async function collect() {
  const found = await Promise.all(EVENTS.map(c => api('/events?sku[]=' + encodeURIComponent(c.sku)).then(d => d[0] || null)));
  const events = await Promise.all(EVENTS.map(async (cfg, i) => {
    const e = {
      ...cfg, status: 'upcoming', rankings: [], awards: [], skills: [],
      link: 'https://events.vex.com/robot-competitions/vex-robotics-competition/' + cfg.sku + '.html'
    };
    const ev = found[i];
    if (!ev) return e;
    e.status = ev.ongoing ? 'live' : (ev.awards_finalized ? 'complete' : 'upcoming');
    const div = (ev.divisions || [])[0];
    const [rk, aw, sk, tm] = await Promise.all([
      div ? api(`/events/${ev.id}/divisions/${div.id}/rankings?per_page=250`) : [],
      api(`/events/${ev.id}/awards?per_page=250`),
      api(`/events/${ev.id}/skills?per_page=250`),
      cfg.key === 'state' ? api(`/events/${ev.id}/teams?per_page=250`) : []
    ]);
    e.rankings = rk.filter(x => ours(x.team)).map(x => ({ team: x.team.name, rank: x.rank, wins: x.wins, losses: x.losses, ties: x.ties }));
    e.awards = aw
      .map(a => ({ title: a.title, teams: (a.teamWinners || []).filter(w => ours(w.team)).map(w => w.team.name) }))
      .filter(a => a.teams.length);
    e.skills = sk.filter(x => ours(x.team))
      .map(x => ({ team: x.team.name, type: skillType(x.type), score: x.score, rank: x.rank, attempts: x.attempts }))
      .sort((a, b) => a.team.localeCompare(b.team) || a.type.localeCompare(b.type));
    if (cfg.key === 'state') e.teams = tm.filter(ours).map(t => t.name).sort();
    return e;
  }));
  const teams = TEAMS.map(num => ({
    number: num,
    results: events.map(e => {
      const r = e.rankings.find(x => x.team === num);
      const aw = e.awards.filter(a => a.teams.includes(num)).map(a => a.title);
      const sk = e.skills.filter(s => s.team === num);
      if (!r && !aw.length && !sk.length) return null;
      return { event: e.name, rank: r ? r.rank : null, wins: r ? r.wins : 0, losses: r ? r.losses : 0, ties: r ? r.ties : 0, awards: aw, skills: sk };
    }).filter(Boolean)
  }));
  return { events, teams };
}

// ---------- rendering (runs at build time, so the page needs almost no JS) ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = v => (v == null || v === '' ? '–' : esc(v));
const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const LABEL = { upcoming: 'Upcoming', live: 'Live now', complete: 'Complete' };
const badge = s => `<span class="badge ${s}">${LABEL[s] || esc(s)}</span>`;
const chips = list => list.map(t => `<span class="chip">${esc(t)}</span>`).join('');

function schedule(d) {
  const rows = d.events.map(e =>
    `<tr><td>${fmt(e.date)}</td><td><a class="row" href="#event-${e.key}"><b>${esc(e.name)}</b></a><div class="meta">${esc(e.venue)}</div></td><td>${badge(e.status)}</td></tr>`).join('');
  return `<table><tr><th>Date</th><th>Event</th><th>Status</th></tr>${rows}</table><p class="meta">Tap an event to see our teams and results.</p>`;
}
function eventList(d) {
  return '<div class="grid">' + d.events.map(e =>
    `<a class="card link" href="#event-${e.key}">${badge(e.status)}<h3>${esc(e.name)}</h3><div class="meta">${fmt(e.date)} · ${esc(e.venue)}</div><div class="chips">${e.teams.length ? chips(e.teams) : '<span class="meta">Teams pending</span>'}</div></a>`).join('') + '</div>';
}
function eventDetail(e) {
  const ranks = e.rankings.length
    ? '<table><tr><th>Team</th><th>Rank</th><th>W-L-T</th></tr>' + e.rankings.map(r => `<tr><td><b>${esc(r.team)}</b></td><td>${val(r.rank)}</td><td>${val(r.wins)}-${val(r.losses)}-${val(r.ties)}</td></tr>`).join('') + '</table>'
    : '<p class="empty">No rankings yet.</p>';
  const skills = e.skills.length
    ? '<table><tr><th>Team</th><th>Type</th><th>Score</th><th>Rank</th></tr>' + e.skills.map(s => `<tr><td><b>${esc(s.team)}</b></td><td>${esc(s.type)}</td><td>${val(s.score)}</td><td>${val(s.rank)}</td></tr>`).join('') + '</table>'
    : '<p class="empty">No skills scores yet.</p>';
  const awards = e.awards.length
    ? e.awards.map(a => `<div class="card"><b>${esc(a.title)}</b><div class="meta">${a.teams.map(esc).join(', ')}</div></div>`).join('')
    : '<p class="empty">No awards yet.</p>';
  return `<a class="back" href="#events">← All events</a><div class="card">${badge(e.status)}<h3 style="font-size:20px">${esc(e.name)}</h3><div class="meta">${fmt(e.date)} · ${esc(e.venue)}</div><div class="chips">${chips(e.teams)}</div><a class="btn" href="${esc(e.link)}" target="_blank" rel="noopener">View on VEX Events</a></div><div class="section-title">Rankings</div>${ranks}<div class="section-title">Skills</div>${skills}<div class="section-title">Awards</div>${awards}`;
}
function teamList(d) {
  return '<div class="grid">' + d.teams.map(t => {
    const last = t.results[t.results.length - 1];
    const line = last && last.rank ? `Latest: #${last.rank} at ${esc(last.event)}` : 'No results yet';
    return `<a class="card link" href="#team-${t.number}"><h3>Team ${esc(t.number)}</h3><div class="meta">${line}</div></a>`;
  }).join('') + '</div>';
}
function teamDetail(t) {
  const rows = t.results.length
    ? '<table><tr><th>Event</th><th>Rank</th><th>W-L-T</th><th>Awards</th></tr>' + t.results.map(r =>
        `<tr><td>${esc(r.event)}</td><td>${val(r.rank)}</td><td>${r.rank ? `${val(r.wins)}-${val(r.losses)}-${val(r.ties)}` : '–'}</td><td>${r.awards.length ? r.awards.map(esc).join(', ') : '–'}</td></tr>`).join('') + '</table>'
    : '<p class="empty">No results yet. Stats appear here after this team competes.</p>';
  const sk = [];
  t.results.forEach(r => r.skills.forEach(s => sk.push(`<tr><td>${esc(r.event)}</td><td>${esc(s.type)}</td><td>${val(s.score)}</td><td>${val(s.rank)}</td><td>${val(s.attempts)}</td></tr>`)));
  const skills = sk.length
    ? '<table><tr><th>Event</th><th>Type</th><th>Score</th><th>Rank</th><th>Attempts</th></tr>' + sk.join('') + '</table>'
    : '<p class="empty">No skills scores yet.</p>';
  return `<a class="back" href="#teams">← All teams</a><h3 style="font-size:22px;margin:0 0 12px">Team ${esc(t.number)}</h3><div class="section-title">Results</div>${rows}<div class="section-title">Skills</div>${skills}`;
}
function state(d) {
  const e = d.events.find(x => x.key === 'state');
  const list = e.teams.length ? `<div class="chips">${chips(e.teams)}</div>` : '<p class="empty">Registered teams will appear here once teams register.</p>';
  return `<div class="card"><h3 style="font-size:20px">State Championship</h3><div class="meta">Mar 12–13, 2027 · Waubonsee Community College, Sugar Grove</div><div class="section-title">Registered Neuqua teams</div>${list}<a class="btn" href="${esc(e.link)}" target="_blank" rel="noopener">View on VEX Events</a></div>`;
}

const CSS = `:root{--navy:#1B2A4A;--navy2:#24386A;--gold:#F3B72B;--ink:#1B2A4A;--muted:#6B7689;--line:#E3E7EF}
*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#fff;color:var(--ink)}
header{background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff;padding:18px 16px 0;border-bottom:4px solid var(--gold)}
h1{margin:0;font-size:22px;letter-spacing:.3px}.sub{color:#C9D2E6;font-size:13px;margin-top:4px}
nav{display:flex;flex-wrap:wrap;gap:2px;margin-top:12px}
nav a{color:#C9D2E6;padding:8px 10px;font-size:13px;text-decoration:none;border-bottom:3px solid transparent}
nav a.on{color:#fff;border-bottom-color:var(--gold);font-weight:600}
main{max-width:960px;margin:0 auto;padding:16px 12px 24px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.card{display:block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;box-shadow:0 1px 2px rgba(20,30,60,.05);margin-bottom:12px;color:inherit;text-decoration:none}
a.link:hover{border-color:var(--gold)}.card h3{margin:0 0 6px;font-size:16px}
.meta{color:var(--muted);font-size:13px;line-height:1.5}
.badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;padding:3px 8px;border-radius:99px;background:#EEF1F7;color:var(--navy);margin-bottom:6px}
.badge.live{background:var(--gold)}.badge.complete{background:var(--navy);color:#fff}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.chip{background:#FDF3D8;border-radius:6px;padding:3px 7px;font-size:12px;font-weight:600}
table{width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid var(--line)}
th{background:var(--navy);color:#fff;text-align:left;font-size:12px;letter-spacing:.4px;text-transform:uppercase;padding:9px 10px}
td{padding:9px 10px;border-top:1px solid var(--line);font-size:14px}tr:nth-child(even) td{background:#FAFBFD}
a.row{color:var(--navy);text-decoration:none}a.row:hover{text-decoration:underline}
.back{display:inline-block;color:var(--navy);font-weight:600;padding:0 0 10px;font-size:14px;text-decoration:none}
.section-title{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 8px}
a.btn{display:inline-block;margin-top:8px;background:var(--gold);color:var(--navy);text-decoration:none;font-weight:700;padding:8px 12px;border-radius:8px;font-size:13px}
.empty{color:var(--muted);font-style:italic;font-size:14px}
@media(max-width:600px){h1{font-size:19px}td,th{padding:8px 6px;font-size:13px}}`;

// ~10 lines of JS: shows the view named in the URL hash
const JS = `function show(){var h=location.hash.slice(1)||'schedule',el=document.getElementById('v-'+h);if(!el){h='schedule';el=document.getElementById('v-schedule')}
document.querySelectorAll('.view').forEach(function(v){v.hidden=v!==el});
var t=h.indexOf('event-')==0?'events':h.indexOf('team-')==0?'teams':h;
document.querySelectorAll('nav a').forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+t)});scrollTo(0,0)}
addEventListener('hashchange',show);show();`;

function page(d) {
  const updated = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' });
  const views = [
    ['schedule', schedule(d)], ['events', eventList(d)], ['teams', teamList(d)], ['state', state(d)],
    ...d.events.map(e => ['event-' + e.key, eventDetail(e)]),
    ...d.teams.map(t => ['team-' + t.number, teamDetail(t)])
  ].map(([id, html]) => `<section class="view" id="v-${id}" hidden>${html}</section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Team 2360 Competitions</title><style>${CSS}</style><noscript><style>.view{display:block!important}.view[hidden]{display:block}</style></noscript></head>
<body><header><h1>Neuqua Valley Robotics · Team 2360</h1><div class="sub">2026–27 Competitions · updated ${esc(updated)} CT</div>
<nav><a href="#schedule">Schedule</a><a href="#events">Events</a><a href="#teams">Teams</a><a href="#state">State</a></nav></header>
<main>${views}</main><script>${JS}</script></body></html>`;
}

const data = await collect();
// If every request failed (bad token, API down), stop so the last good page stays live.
if (calls > 0 && failures === calls) { console.error('All VEX requests failed. Not publishing.'); process.exit(1); }
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', page(data));
console.log(`Built dist/index.html (${calls} requests, ${failures} failed)`);
