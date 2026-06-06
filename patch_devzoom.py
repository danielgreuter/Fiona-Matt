#!/usr/bin/env python3
# Fügt einen Zoom-in für den Swiss-Athletics-Entwicklungs-Chart (Übersicht) hinzu:
# oben grosser Chart, unten Tabelle der besten 10 (Zeit/Weite, Wind, Wettkampf).
# Idempotent: erkennt bereits gepatchte Dateien am Marker "dev-zoom-overlay".
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

if 'dev-zoom-overlay' in html:
    print('Bereits gepatcht – keine Aenderung.')
    sys.exit(0)

changed = 0

# ── 1) Karte klickbar machen ──────────────────────────────────────────────
old_card = '            <div class="card" style="margin-bottom:14px">'
new_card = ('            <div class="card" id="dev-chart-card" '
            'style="margin-bottom:14px;cursor:pointer" onclick="openDevChartZoom()">')
if old_card in html:
    html = html.replace(old_card, new_card, 1)
    changed += 1
else:
    sys.exit('Anker (dev-chart card) nicht gefunden – Abbruch.')

# ── 2) CSS einfügen (vor </style>) ────────────────────────────────────────
css = r"""
/* ── Dev-Chart Zoom (Uebersicht) ── */
.dz-chart-wrap { background: var(--surface2); border: 1px solid var(--border); border-radius: 14px; padding: 12px 8px 6px; margin-bottom: 8px; }
.dz-head { display: grid; grid-template-columns: 26px 70px 52px 1fr; gap: 8px; padding: 2px 8px 7px; font-size: 9px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--text-dim); }
.dz-row { display: grid; grid-template-columns: 26px 70px 52px 1fr; align-items: center; gap: 8px; padding: 8px; border-radius: 9px; font-size: 12px; margin-bottom: 3px; background: var(--surface2); border: 1px solid var(--border); }
.dz-row.best { background: var(--gold-light); border: 1px solid var(--gold); }
.dz-rank { font-family: 'DM Mono', monospace; font-weight: 800; color: var(--text-muted); font-size: 11px; }
.dz-row.best .dz-rank { color: var(--gold); }
.dz-time { font-family: 'DM Mono', monospace; font-weight: 600; color: var(--text); }
.dz-row.best .dz-time { color: var(--gold); }
.dz-wind { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.dz-wind .wa { color: var(--red); }
.dz-loc { font-size: 11px; color: var(--text-dim); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dz-loc small { opacity: .7; }
"""
css_anchor = '.rz-t5-dots { text-align: center; color: var(--text-dim); font-size: 12px; padding: 2px 0; letter-spacing: 2px; }'
if css_anchor in html:
    html = html.replace(css_anchor, css_anchor + '\n' + css, 1)
    changed += 1
else:
    # Fallback: direkt vor </style>
    html = html.replace('</style>', css + '\n</style>', 1)
    changed += 1

# ── 3) Overlay + JS (vor </body>) ─────────────────────────────────────────
block = r"""
<!-- Dev-Chart Zoom Overlay -->
<div class="rz-overlay" id="dev-zoom-overlay" onclick="if(event.target===this)closeDevChartZoom()">
  <div class="rz-card" id="dev-zoom-card"></div>
</div>
<script>
function dzFmtWind(r){
  if (r.indoor) return 'Halle';
  if (r.wind === null || r.wind === undefined || r.wind === '') return '\u2014';
  var w = Number(r.wind);
  if (isNaN(w)) return '\u2014';
  var s = (w > 0 ? '+' : '') + w.toFixed(1);
  return r.windAssisted ? '<span class="wa">' + s + '</span>' : s;
}
function openDevChartZoom(){
  var disc = (typeof currentDisc !== 'undefined' && currentDisc) ? currentDisc : '100m';
  var labels  = { '60m':'60m', '100m':'100m', '200m':'200m', '80m':'80m', 'Long Jump':'Weitsprung' };
  var pillCls = { '100m':'rz-disc-100m', '60m':'rz-disc-60m', '200m':'rz-disc-200m', 'Long Jump':'rz-disc-lj', '80m':'rz-disc-80m' };
  var colors  = { '100m':'#E0601F', '60m':'#2563EB', 'Long Jump':'#059669', '200m':'#7C3AED' };
  var isJump  = disc === 'Long Jump';
  var color   = colors[disc] || '#E0601F';
  var fmt     = isJump ? function(v){ return v.toFixed(2) + ' m'; } : function(v){ return v.toFixed(2); };

  // Chart-Rows: gleiche Logik wie renderDevChart (zeitliche Entwicklung)
  var rows = [];
  if (typeof saResultsData !== 'undefined' && saResultsData && saResultsData.results && saResultsData.results.length){
    rows = saResultsData.results
      .filter(function(r){ return r.discipline === disc && r.result && r.dateISO && !r.windAssisted; })
      .sort(function(a,b){ return a.dateISO.localeCompare(b.dateISO); })
      .map(function(r){ return { val: parseFloat(String(r.result).replace(',','.')), label: (r.dateISO||'').slice(0,7) }; })
      .filter(function(r){ return !isNaN(r.val); });
  }
  if (!rows.length){
    rows = ((typeof FIONA !== 'undefined' && FIONA.disciplineHistory && FIONA.disciplineHistory[disc]) || [])
      .map(function(r){ return { val:r.val, label:r.label }; });
  }

  // Beste 10: alle SA-Resultate dieser Disziplin nach Leistung sortiert
  var all = ((typeof saResultsData !== 'undefined' && saResultsData && saResultsData.results) ? saResultsData.results : [])
    .filter(function(r){ return r.discipline === disc && r.result; })
    .map(function(r){
      return {
        val: parseFloat(String(r.result).replace(',','.')),
        wind: (r.wind === 0 || r.wind) ? r.wind : null,
        windAssisted: !!r.windAssisted,
        indoor: !!r.indoor,
        venue: r.venue || r.competition || '',
        competition: r.competition || '',
        date: r.date || ((r.dateISO||'').split('-').reverse().join('.'))
      };
    })
    .filter(function(r){ return !isNaN(r.val); });
  all.sort(function(a,b){ return isJump ? b.val - a.val : a.val - b.val; });
  var best10 = all.slice(0, 10);

  var tableRows = best10.map(function(r, i){
    var loc = r.venue || r.competition || '\u2014';
    var dateSmall = r.date ? ' <small>\u00b7 ' + r.date + '</small>' : '';
    return '<div class="dz-row' + (i === 0 ? ' best' : '') + '">' +
             '<div class="dz-rank">' + (i+1) + '</div>' +
             '<div class="dz-time">' + Number(r.val).toFixed(2) + '</div>' +
             '<div class="dz-wind">' + dzFmtWind(r) + '</div>' +
             '<div class="dz-loc">' + loc + dateSmall + '</div>' +
           '</div>';
  }).join('');
  if (!tableRows) tableRows = '<div style="font-size:12px;color:var(--text-dim);padding:10px 4px">Keine Resultate.</div>';

  var card = document.getElementById('dev-zoom-card');
  card.innerHTML =
    '<button class="rz-close-btn" onclick="closeDevChartZoom()">\u2715</button>' +
    '<div class="rz-header">' +
      '<span class="rz-disc-pill ' + (pillCls[disc] || 'rz-disc-other') + '">' + (labels[disc] || disc) + '</span>' +
      '<span class="rz-tag">Entwicklung</span>' +
      '<span class="rz-tag">Swiss Athletics</span>' +
    '</div>' +
    '<div class="dz-chart-wrap"><div id="dev-zoom-chart-svg"></div></div>' +
    '<div class="rz-top5" style="margin-top:6px">' +
      '<div class="rz-top5-title">Beste 10 \u00b7 ' + (isJump ? 'Weite' : 'Zeit') + ' \u00b7 Wind \u00b7 Wettkampf</div>' +
      '<div class="dz-head"><div></div><div>' + (isJump ? 'Weite' : 'Zeit') + '</div><div>Wind</div><div>Wettkampf</div></div>' +
      tableRows +
    '</div>';

  try { drawLineChart('dev-zoom-chart-svg', rows, { color: color, better: isJump ? 'higher' : 'lower', fmt: fmt }); }
  catch(e){ console.error('dev zoom chart:', e); }
  var svg = document.querySelector('#dev-zoom-chart-svg svg');
  if (svg){ svg.setAttribute('height', '210'); svg.style.height = '210px'; svg.style.width = '100%'; }

  document.getElementById('dev-zoom-overlay').classList.add('open');
}
function closeDevChartZoom(){
  var o = document.getElementById('dev-zoom-overlay');
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
