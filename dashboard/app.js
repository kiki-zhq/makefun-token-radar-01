/* Token Radar's page: renders the board from window.RADAR (written by main.ts),
 * filters and sorts it in the page, and opens a detail view per protocol.
 * No network: every row, step and number comes from the data file beside the page. */
'use strict';

var R = window.RADAR;
var WATCH = {};
R.watchlist.forEach(function (s) { WATCH[s] = true; });

/* -- formatting ----------------------------------------------------------- */

function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
}

function moneyFull(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function pct(v) {
  if (v === null || v === undefined) return { text: '—', cls: 'flat' };
  var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  return { text: s, cls: v > 0 ? 'up' : v < 0 ? 'down' : 'flat' };
}

function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return (days / 365).toFixed(1) + 'y';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* -- header facts ---------------------------------------------------------- */

document.getElementById('asOf').textContent = R.as_of;
document.getElementById('footDate').textContent = R.as_of;
document.getElementById('statScanned').textContent = R.protocols_scanned;
document.getElementById('statPre').textContent = R.pre_token_count;
document.getElementById('statWatch').textContent = R.watchlist_size + ' / ' + R.watchlist_size;
document.getElementById('statBoard').textContent = R.board_size;
document.getElementById('modelTag').textContent = 'model ' + R.model_version;

/* -- filter controls ------------------------------------------------------- */

var state = { q: '', cat: '', chain: '', scope: 'all', sort: 'value' };

function fillSelect(id, values) {
  var el = document.getElementById(id);
  values.slice().sort().forEach(function (v) {
    var o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  });
}

var cats = {};
var chains = {};
R.rows.forEach(function (r) {
  if (r.category) cats[r.category] = true;
  r.chains.forEach(function (c) { chains[c] = true; });
});
fillSelect('cat', Object.keys(cats));
fillSelect('chain', Object.keys(chains));

['q', 'cat', 'chain', 'scope', 'sort'].forEach(function (id) {
  document.getElementById(id).addEventListener('input', function (e) {
    state[id] = e.target.value;
    renderBoard();
  });
});

/* -- the board ------------------------------------------------------------- */

var tbody = document.getElementById('rows');

function filteredRows() {
  var q = state.q.trim().toLowerCase();
  var rows = R.rows.filter(function (r) {
    if (state.scope === 'watchlist' && !WATCH[r.slug]) return false;
    if (state.scope === 'top50' && r.rank > 50) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
    if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  var by = {
    value: function (a, b) { return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
    growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0) || a.rank - b.rank; },
    age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0) || a.rank - b.rank; },
    name: function (a, b) { return a.name.localeCompare(b.name); },
  }[state.sort];
  return rows.sort(by);
}

function chainPills(r) {
  return r.chains.slice(0, 3).map(function (c) {
    return '<span class="pill">' + esc(c) + '</span>';
  }).join('') + (r.chains.length > 3 ? ' <span class="pill">+' + (r.chains.length - 3) + '</span>' : '');
}

function renderBoard() {
  var rows = filteredRows();
  var html = '';
  rows.forEach(function (r) {
    var g = pct(r.change_7d);
    html += '<tr data-slug="' + esc(r.slug) + '">'
      + '<td class="num rank">' + r.rank + '</td>'
      + '<td class="pname">' + esc(r.name) + (WATCH[r.slug] ? ' <span class="watch">WATCHLIST</span>' : '')
      + '<span class="slug">' + esc(r.slug) + '</span></td>'
      + '<td>' + esc(r.category || '—') + '</td>'
      + '<td>' + chainPills(r) + '</td>'
      + '<td class="num">' + money(r.tvl_usd) + '</td>'
      + '<td class="num ' + g.cls + '">' + g.text + '</td>'
      + '<td class="num">' + ageText(r.age_days) + '</td>'
      + '<td class="num value">' + money(r.implied_value_usd) + '</td></tr>';
  });
  tbody.innerHTML = html || '<tr><td colspan="8">No protocols match this filter.</td></tr>';
  document.getElementById('count').textContent = rows.length + ' of ' + R.rows.length + ' protocols';
}

tbody.addEventListener('click', function (e) {
  var tr = e.target.closest('tr[data-slug]');
  if (tr) openDetail(tr.getAttribute('data-slug'));
});

/* -- the detail view ------------------------------------------------------- */

var detail = document.getElementById('detail');

function openDetail(slug) {
  var r = null;
  R.rows.forEach(function (row) { if (row.slug === slug) r = row; });
  if (!r) return;
  document.querySelectorAll('#rows tr.open').forEach(function (tr) { tr.classList.remove('open'); });
  var tr = tbody.querySelector('tr[data-slug="' + slug + '"]');
  if (tr) tr.classList.add('open');

  document.getElementById('dName').textContent = '#' + r.rank + '  ' + r.name;
  var g = pct(r.change_7d);
  document.getElementById('dMeta').textContent =
    r.slug + ' · ' + (r.category || 'uncategorised') + ' · ' + r.chains.join(', ')
    + ' · TVL ' + moneyFull(r.tvl_usd) + ' · 7-day ' + g.text
    + ' · tracked since ' + (r.listed_at || 'unknown') + ' (' + ageText(r.age_days) + ')'
    + ' · records no token';
  var m = r.model;
  var rowsHtml = [
    ['TVL', moneyFull(r.tvl_usd)],
    ['TVL multiple  0.60 × (TVL / $1M)^−0.15, clamped 0.10–0.60', m.multiple.toFixed(3) + '×'],
    ['Base value  TVL × multiple', moneyFull(m.base_usd)],
    ['7-day growth  ' + m.growth_pct.toFixed(1) + '%', m.growth_multiplier.toFixed(3) + '×'],
    ['Maturity  ' + m.age_days + ' days with no token', m.maturity_multiplier.toFixed(3) + '×'],
    ['Chain breadth  ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), m.breadth_multiplier.toFixed(3) + '×'],
    ['Implied value', moneyFull(r.implied_value_usd)],
  ].map(function (kv) {
    return '<tr><td>' + esc(kv[0]) + '</td><td>' + esc(kv[1]) + '</td></tr>';
  }).join('');
  document.getElementById('dModel').innerHTML = rowsHtml;
  document.getElementById('dNote').textContent =
    'The implied value is this radar\u2019s own claim from the snapshot\u2019s figures. '
    + 'It says nothing about whether or when ' + r.name + ' issues a token.';
  document.getElementById('dSteps').innerHTML = r.farm_steps.map(function (s) {
    return '<li>' + esc(s) + '</li>';
  }).join('');
  detail.hidden = false;
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('dClose').addEventListener('click', function () {
  detail.hidden = true;
  document.querySelectorAll('#rows tr.open').forEach(function (tr) { tr.classList.remove('open'); });
});

/* Escape closes the detail view too, so keyboard readers can leave it. */
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !detail.hidden) {
    detail.hidden = true;
    document.querySelectorAll('#rows tr.open').forEach(function (tr) { tr.classList.remove('open'); });
  }
});

/* -- already trading ------------------------------------------------------- */

(function renderLive() {
  var html = '';
  R.live.forEach(function (p) {
    var g = pct(p.change_7d);
    html += '<tr><td class="pname">' + esc(p.name)
      + (p.symbol ? ' <span class="slug">' + esc(p.symbol) + '</span>' : '') + '</td>'
      + '<td>' + esc(p.category || '—') + '</td>'
      + '<td class="num">' + money(p.tvl_usd) + '</td>'
      + '<td class="num">' + money(p.mcap_usd) + '</td>'
      + '<td class="num ' + g.cls + '">' + g.text + '</td></tr>';
  });
  document.getElementById('liveRows').innerHTML = html;
})();

renderBoard();
