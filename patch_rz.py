import re, sys

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

OLD = """document.addEventListener('click',function(e){
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
});"""

NEW = """document.addEventListener('click',function(e){
  var node=e.target;
  for(var i=0;i<8&&node&&node!==document.body;i++){
    if(node.tagName==='DIV'&&node.children.length>=2&&node.children.length<=10){
      var kids=[].slice.call(node.children);
      var texts=kids.map(function(k){return k.textContent.trim();});
      var timeVal=texts.find(function(t){return /^\\d{1,2}\\.\\d{2}$/.test(t);});
      if(timeVal){
        _rzLoad(function(d){
          var idx=-1;
          var dateVal=texts.find(function(t){return /\\d{2}\\.\\d{2}\\.\\d{4}/.test(t);});
          d.results.forEach(function(r,ii){
            if(idx>=0)return;
            if(r.result===timeVal&&(!dateVal||r.date===dateVal))idx=ii;
          });
          if(idx<0)d.results.forEach(function(r,ii){
            if(idx>=0)return;
            if(r.result===timeVal)idx=ii;
          });
          if(idx>=0)rzOpen(idx);
        });
        return;
      }
    }
    node=node.parentElement;
  }
},true);"""

if OLD.strip()[:50] in html:
    html = html.replace(OLD, NEW)
    print('OK: Click-Handler ersetzt')
else:
    m = re.search(r"document\.addEventListener\('click',function\(e\)\{.*?closest.*?\},\s*true\);", html, re.DOTALL)
    if not m:
        m = re.search(r"document\.addEventListener\('click',function\(e\)\{.*?result-item.*?\}\);", html, re.DOTALL)
    if m:
        html = html[:m.start()] + NEW + html[m.end():]
        print('OK: Click-Handler ersetzt (regex)')
    else:
        html = html.replace('function rzOpen(idx){', NEW + '\nfunction rzOpen(idx){', 1)
        print('OK: Click-Handler vorangestellt')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Fertig')
