#!/usr/bin/env python3
# Fügt einen Zoom-in für den World-Athletics-Score-Chart (Übersicht, unterer Chart)
# hinzu: oben grosser WA-Score-Chart, unten Tabelle der besten 10 nach WA-Punkten
# mit WA-Punkte, Zeit/Weite, Wind, Wettkampf.
# Idempotent: erkennt bereits gepatchte Dateien am Marker "wa-zoom-overlay".
import io, sys, glob

def find_index():
    cands = glob.glob('index.html') + glob.glob('**/index.html', recursive=True)
    cands = [c for c in cands if 'node_modules' not in c]
    if not cands:
        sys.exit('index.html nicht gefunden')
    cands.sort(key=len)
    return cands[0]

PATH = find_index()
with io.open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()

if 'wa-zoom-overlay' in html:
    print('Bereits gepatcht – keine Aenderung.')
    sys.exit(0)

changed = 0

# ── 1) WA-Score-Karte klickbar machen ─────────────────────────────────────
old_card = '\n<div class="card">\n        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
new_card = '\n<div class="card" id="score-chart-card" style="cursor:pointer" onclick="openWAScoreZoom()">\n        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
if old_card in html:
    html = html.replace(old_card, new_card, 1)
    changed += 1
else:
    sys.exit('Anker (WA-Score card) nicht gefunden – Abbruch.')

# ── 2) CSS einfügen ───────────────────────────────────────────────────────
css = r"""
/* ── WA-Score Zoom (Uebersicht) ── */
.wz-head { display: grid; grid-template-columns: 22px 50px 58px 44px 1fr; gap: 8px; padding: 2px 8px 7px; font-size: 9px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--text-dim); }
.wz-row { display: grid; grid-template-columns: 22px 50px 58px 44px 1fr; align-items: center; gap: 8px; padding: 8px; border-radius: 9px; font-size: 12px; margin-bottom: 3px; background: var(--surface2); border: 1px solid var(--border); }
.wz-row.best { background: var(--gold-light); border: 1px solid var(--gold); }
.wz-rank { font-family: 'DM Mono', monospace; font-weight: 800; color: var(--text-muted); font-size: 11px; }
.wz-row.best .wz-rank { color: var(--gold); }
.wz-pts { font-family: 'DM Mono', monospace; font-weight: 800; color: var(--blue); }
.wz-res { font-family: 'DM Mono', monospace; font-weight: 600; color: var(--text); }
.wz-wind { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.wz-wind .wa { color: var(--red); }
.wz-loc { font-size: 11px; color: var(--text-dim); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-loc small { opacity: .7; }
"""
css_anchor = '.dz-loc small { opacity: .7; }'
if css_anchor in html:
    html = html.replace(css_anchor, css_anchor + '\n' + css, 1)
    changed += 1
else:
    html = html.replace('</style>', css + '\n</style>', 1)
    changed += 1

# ── 3) Overlay + JS (vor </body>) ─────────────────────────────────────────
block = r"""
<!-- WA-Score Zoom Overlay -->
<div class="rz-overlay" id="wa-zoom-overlay" onclick="if(event.target===this)closeWAScoreZoom()">
  <div class="rz-card" id="wa-zoom-card"></div>
</div>
<script>
function wzFmtDate(d){
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0,10).split('-').reverse().join('.');
  return d;
}
function wzFmtWind(r){
  if (r.indoor) return 'Halle';
  var w = r.wind;
  if (w === null || w === undefined || w === '') return '\u2014';
  var n = Number(w);
  if (isNaN(n)) return '\u2014';
  var s = (n > 0 ? '+' : '') + n.toFixed(1);
  return (n > 2.0) ? '<span class="wa">' + s + '</span>' : s;
}
function wzNormDisc(d){
  if (!d) return null;
  if (d.indexOf('60') >= 0) return '60m';
  if (d.indexOf('100') >= 0) return '100m';
  if (d.indexOf('200') >= 0) return '200m';
  if (d.indexOf('Jump') >= 0 || d.indexOf('Weit') >= 0) return 'Long Jump';
  return null;
}
function openWAScoreZoom(){
  var key = (typeof window !== 'undefined' && window.currentWAScoreDisc) ? window.currentWAScoreDisc
            : ((typeof currentDisc !== 'undefined' && currentDisc) ? currentDisc : '100m');
  var norm = { '60m Halle':'60m', '60 Metres':'60m', '100 Metres':'100m', '200 Metres':'200m', 'Weitsprung':'Long Jump', 'Long Jump':'Long Jump' };
  key = norm[key] || key;
  var labels  = { '60m':'60m', '100m':'100m', '200m':'200m', '80m':'80m', 'Long Jump':'Weitsprung' };
  var pillCls = { '100m':'rz-disc-100m', '60m':'rz-disc-60m', '200m':'rz-disc-200m', 'Long Jump':'rz-disc-lj', '80m':'rz-disc-80m' };
  var colors  = { '100m':'#E0601F', '60m':'#2563EB', 'Long Jump':'#059669', '200m':'#7C3AED' };
  var isJump  = key === 'Long Jump';
  var color   = colors[key] || '#E0601F';

  // Chart-Rows: gleiche Logik wie renderScoreChart (WA Score)
  var rows = [];
  if (typeof window !== 'undefined' && window.waScoreByDisc && window.waScoreByDisc[key] && window.waScoreByDisc[key].length){
    rows = window.waScoreByDisc[key]
      .map(function(r){ return { val: Number(r.score), label: String(r.date || '') }; })
      .filter(function(r){ return !isNaN(r.val) && r.val > 0; });
  }
  if (!rows.length){
    rows = ((typeof FIONA !== 'undefined' && FIONA.seasons && FIONA.seasons.waScoreHistory && FIONA.seasons.waScoreHistory[key]) || [])
      .map(function(r){ return { val: r.val, label: r.label }; });
  }

  // Beste 10 nach WA-Punkten – reichste Quelle: window.waResults (mit Wind/Venue)
  var src = (typeof window !== 'undefined' && window.waResults && window.waResults.length) ? window.waResults
            : ((typeof saResultsData !== 'undefined' && saResultsData && saResultsData.results) ? saResultsData.results : []);
  var all = src
    .filter(function(r){ return r.score && wzNormDisc(r.discipline) === key; })
    .map(function(r){
      return {
        score: Number(r.score),
        result: r.result || '',
        wind: (r.wind === 0 || r.wind) ? r.wind : null,
        indoor: !!r.indoor,
        venue: r.venue || r.competition || '',
        competition: r.competition || '',
        date: r.date || ((r.dateISO||'').split('-').reverse().join('.'))
      };
    })
    .filter(function(r){ return !isNaN(r.score) && r.score > 0; });
  // Duplikate entfernen (gleiches Datum + Score + Resultat)
  var seen = {};
  all = all.filter(function(r){ var k = r.date + '|' + r.score + '|' + r.result; if (seen[k]) return false; seen[k] = 1; return true; });
  all.sort(function(a,b){ return b.score - a.score; });
  var best10 = all.slice(0, 10);

  var tableRows = best10.map(function(r, i){
    var loc = r.venue || r.competition || '\u2014';
    var dateSmall = r.date ? ' <small>\u00b7 ' + wzFmtDate(r.date) + '</small>' : '';
    var res = r.result ? r.result : '\u2014';
    return '<div class="wz-row' + (i === 0 ? ' best' : '') + '">' +
             '<div class="wz-rank">' + (i+1) + '</div>' +
             '<div class="wz-pts">' + Math.round(r.score) + '</div>' +
             '<div class="wz-res">' + res + '</div>' +
             '<div class="wz-wind">' + wzFmtWind(r) + '</div>' +
             '<div class="wz-loc">' + loc + dateSmall + '</div>' +
           '</div>';
  }).join('');
  if (!tableRows) tableRows = '<div style="font-size:12px;color:var(--text-dim);padding:10px 4px">Keine WA-Resultate.</div>';

  var card = document.getElementById('wa-zoom-card');
  card.innerHTML =
    '<button class="rz-close-btn" onclick="closeWAScoreZoom()">\u2715</button>' +
    '<div class="rz-header">' +
      '<span class="rz-disc-pill ' + (pillCls[key] || 'rz-disc-other') + '">' + (labels[key] || key) + '</span>' +
      '<span class="rz-tag">WA Score</span>' +
      '<span class="rz-tag">World Athletics</span>' +
    '</div>' +
    '<div class="dz-chart-wrap"><div id="wa-zoom-chart-svg"></div></div>' +
    '<div class="rz-top5" style="margin-top:6px">' +
      '<div class="rz-top5-title">Beste 10 \u00b7 WA-Punkte</div>' +
      '<div class="wz-head"><div></div><div>Pkt.</div><div>' + (isJump ? 'Weite' : 'Zeit') + '</div><div>Wind</div><div>Wettkampf</div></div>' +
      tableRows +
    '</div>';

  try { drawLineChart('wa-zoom-chart-svg', rows, { color: color, better: 'higher', fmt: function(v){ return Math.round(v).toString(); } }); }
  catch(e){ console.error('wa zoom chart:', e); }
  var svg = document.querySelector('#wa-zoom-chart-svg svg');
  if (svg){ svg.setAttribute('height', '210'); svg.style.height = '210px'; svg.style.width = '100%'; }

  document.getElementById('wa-zoom-overlay').classList.add('open');
}
function closeWAScoreZoom(){
  var o = document.getElementById('wa-zoom-overlay');
  if (o) o.classList.remove('open');
}
</script>
"""
if '</body>' in html:
    html = html.replace('</body>', block + '\n</body>', 1)
    changed += 1
else:
    sys.exit('</body> nicht gefunden – Abbruch.')

with io.open(PATH, 'w', encoding='utf-8') as f:
    f.write(html)

print('OK – ' + str(changed) + ' Aenderungen in ' + PATH)
