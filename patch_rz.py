import re, sys

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

NEW_HANDLER = r"""document.addEventListener('click',function(e){
  var node=e.target;
  for(var i=0;i<10&&node&&node!==document.body;i++){
    var txt=(node.textContent||'').trim();
    var tm=txt.match(/\b(\d{1,2}\.\d{2})\b(?!\.\d)/);
    var dm=txt.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);
    if(tm&&dm&&txt.length>15&&txt.length<600){
      var tv=tm[1],dv=dm[1];
      _rzLoad(function(d){
        var idx=-1;
        d.results.forEach(function(r,ii){if(idx>=0)return;if(r.result===tv&&r.date===dv)idx=ii;});
        if(idx<0)d.results.forEach(function(r,ii){if(idx>=0)return;if(r.result===tv)idx=ii;});
        if(idx>=0)rzOpen(idx);
      });
      return;
    }
    node=node.parentElement;
  }
},true);"""

m = re.search(r"document\.addEventListener\('click',function\(e\)\{.*?\},true\);", html, re.DOTALL)
if m:
    html = html[:m.start()] + NEW_HANDLER + html[m.end():]
    print('OK: Handler ersetzt')
else:
    html = html.replace('function rzOpen(idx){', NEW_HANDLER + '\nfunction rzOpen(idx){', 1)
    print('OK: Handler vorangestellt')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Fertig')
