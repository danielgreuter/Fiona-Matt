import re, sys

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

changes = 0

# 1. Overlay: flex-end → center, padding anpassen
old1 = 'z-index: 1000; align-items: flex-end; justify-content: center;\n  padding: 0 0 env(safe-area-inset-bottom,12px);'
new1 = 'z-index: 1000; align-items: center; justify-content: center;\n  padding: 16px;'
if old1 in html:
    html = html.replace(old1, new1, 1); changes += 1; print('OK: overlay zentriert')
else:
    html = re.sub(r'align-items: flex-end;(.*?)padding: 0 0 env\(safe-area-inset-bottom[^;]+\);', 
                  'align-items: center;\\1padding: 16px;', html, count=1, flags=re.DOTALL)
    changes += 1; print('OK: overlay zentriert (regex)')

# 2. Card: bottom-sheet Radius + Shadow → nec-modal Stil
old2 = 'background: var(--surface); border-radius: 20px 20px 14px 14px;\n  padding: 20px 18px 24px; width: 100%; max-width: 480px;\n  box-shadow: 0 -4px 40px rgba(0,0,0,0.18), 0 20px 60px rgba(0,0,0,0.45);\n  animation: necSlideIn 0.22s ease; max-height: 88vh; overflow-y: auto;\n  position: relative;'
new2 = 'background: var(--surface); border-radius: 20px;\n  padding: 20px 18px 24px; width: 100%; max-width: 420px;\n  box-shadow: 0 20px 60px rgba(0,0,0,0.45);\n  animation: necSlideIn 0.22s ease; max-height: 85vh; overflow-y: auto;\n  position: relative;'
if old2 in html:
    html = html.replace(old2, new2, 1); changes += 1; print('OK: card style angepasst')
else:
    html = re.sub(r'border-radius: 20px 20px 14px 14px;', 'border-radius: 20px;', html, count=1)
    html = re.sub(r'box-shadow: 0 -4px 40px rgba\(0,0,0,0\.18\), 0 20px 60px rgba\(0,0,0,0\.45\);',
                  'box-shadow: 0 20px 60px rgba(0,0,0,0.45);', html, count=1)
    html = re.sub(r'max-width: 480px;', 'max-width: 420px;', html, count=1)
    changes += 1; print('OK: card style angepasst (einzeln)')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print(f'Fertig ({changes} Aenderungen)')
