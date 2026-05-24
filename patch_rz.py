import re, sys

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Alten Zoom-Code entfernen (falls vorhanden)
html = re.sub(r'// \u2500\u2500 RESULT ZOOM \u2500+.*?\n// \u2500{30,}\n', '', html, count=1, flags=re.DOTALL)

# Neuer Zoom-Code
NEW_JS = '''
// \u2500\u2500 RESULT ZOOM \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
var _rzData=null;
var _rzWorker='https://fiona-proxy.daniel-greuter.workers.dev';
function _rzLoad(cb){
  if(_rzData){cb(_rzData);return;}
  fetch(_rzWorker+'?action=sa-results')
    .then(function(r){return r.json();})
    .then(function(d){if(d&&d.results){_rzData=d;cb(d);}})
    .catch(function(e){console.error('RZ',e);});
}
document.addEventListener('click',function(e){
  var item=e.target&&e.target.closest&&e.target.closest('.result-item');
  if(!item)return;
  var tEl=item.querySelector('.result-time');
  var cEl=item.querySelector('.result-competition');
  if(!tEl)return;
  var t=tEl.textContent.trim();
  var c=cEl?cEl.textContent.trim():'';
  _rzLoad(function(d){
    var idx=-1;
    d.results.forEach(function(r,i){
      if(idx>=0)return;
      var cc=r.competition.replace(/\\s*\\(WRC[^)]*\\)\\s*/i,'').trim();
      if(r.result===t&&(c===''||r.competition.indexOf(c)>=0||c.indexOf(cc)>=0))idx=i;
    });
    if(idx>=0)rzOpen(idx);
  });
});
function rzDiscClass(d){
  d=(d||'').toLowerCase().replace(/\\s/g,'');
  if(d==='100m')return 'rz-disc-100m';
  if(d==='60m')return 'rz-disc-60m';
  if(d==='200m')return 'rz-disc-200m';
  if(d.indexOf('jump')>=0||d.indexOf('weit')>=0)return 'rz-disc-lj';
  if(d==='80m')return 'rz-disc-80m';
  return 'rz-disc-other';
}
function rzDecodePlatz(p){
  if(!p)return'';
  var m=String(p).match(/^(\\d+)(qf|sf|[rfh])?(\\d+)?$/i);
  if(!m)return'Rang '+p;
  var rank=m[1],round=(m[2]||'').toLowerCase(),num=m[3]||'';
  var R={r:'Lauf',h:'Vorlauf',f:'Final',qf:'Viertelfinale',sf:'Halbfinale'};
  var s='Rang '+rank;
  if(round&&R[round])s+=' \\u00B7 '+R[round]+(num?' '+num:'');
  return s;
}
function rzOpen(idx){
  var d=_rzData;if(!d||!d.results)return;
  var r=d.results[idx];if(!r)return;
  var hdr=document.getElementById('rz-header');
  var indoor=r.indoor?'\\uD83C\\uDFDF Halle':'\\u2600\\uFE0F Outdoor';
  hdr.innerHTML='<span class="rz-disc-pill '+rzDiscClass(r.discipline)+'">'+r.discipline+'</span>'
    +'<span class="rz-tag">'+indoor+'</span>'
    +'<span class="rz-tag">'+r.year+'</span>';
  document.getElementById('rz-time').textContent=r.result||'\\u2013';
  var wEl=document.getElementById('rz-wind');
  if(r.wind!==null&&r.wind!==undefined&&!r.indoor){
    wEl.textContent='Wind: '+(r.wind>=0?'+':'')+r.wind+' m/s';
    wEl.style.display='';
  }else{wEl.style.display='none';}
  var pb=d.pbs&&d.pbs[r.discipline];
  document.getElementById('rz-pb').style.display=(pb&&pb.result===r.result&&pb.date===r.date)?'':'none';
  var cc=r.competition.replace(/\\s*\\(WRC[^)]*\\)\\s*/i,'').trim();
  var isWRC=/WRC/i.test(r.competition);
  document.getElementById('rz-details').innerHTML=
    '<div class="rz-row"><span class="rz-row-icon">\\uD83C\\uDF96</span><span class="rz-row-text">'+rzDecodePlatz(r.place)+'</span></div>'
    +'<div class="rz-row"><span class="rz-row-icon">\\uD83C\\uDFC6</span><span class="rz-row-text">'+cc+(isWRC?'<span class="rz-wrc">WRC</span>':'')+'</span></div>'
    +'<div class="rz-row"><span class="rz-row-icon">\\uD83D\\uDCCD</span><span class="rz-row-text">'+(r.venue||'\\u2013')+'</span></div>'
    +'<div class="rz-row"><span class="rz-row-icon">\\uD83D\\uDCC5</span><span class="rz-row-text">'+(r.date||'\\u2013')+'</span></div>';
  var sameDay=d.results.filter(function(x,i){return i!==idx&&x.competition===r.competition&&x.date===r.date;});
  var sdEl=document.getElementById('rz-sameday');
  if(sameDay.length>0){
    document.getElementById('rz-sd-list').innerHTML=sameDay.map(function(x){
      var wi=(x.wind!==null&&!x.indoor)?' <span style="color:var(--text-dim);font-size:11px">'+(x.wind>=0?'+':'')+x.wind+'</span>':'';
      return '<div class="rz-sd-item" onclick="rzOpen('+d.results.indexOf(x)+')">'
        +'<span class="rz-sd-disc">'+x.discipline+'</span>'
        +'<span class="rz-sd-time">'+x.result+wi+'</span>'
        +'<span class="rz-sd-place">'+(x.place||'')+'</span></div>';
    }).join('');
    sdEl.style.display='';
  }else{sdEl.style.display='none';}
  document.getElementById('rz-overlay').classList.add('open');
}
function rzClose(){document.getElementById('rz-overlay').classList.remove('open');}
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
'''

# CSS cursor:pointer hinzufügen falls nicht vorhanden
if 'cursor: pointer; /* rz */' not in html:
    html = html.replace(
        '.rz-sd-place { font-size:11px; color:var(--text-dim); font-weight:600; }',
        '.rz-sd-place { font-size:11px; color:var(--text-dim); font-weight:600; }\n.result-item { cursor: pointer; /* rz */ }'
    )

# JS einfügen vor letztem </script>
pos = html.rfind('</script>')
if pos >= 0:
    html = html[:pos] + NEW_JS + html[pos:]
    print('OK: Zoom-Code eingefuegt')
else:
    print('FEHLER: Kein </script> gefunden')
    sys.exit(1)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Fertig: index.html geschrieben')
