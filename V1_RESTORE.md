# Originalversion – fester Rückkehrpunkt

Daniels bestehende Version vor dem Designumbau ist im vollständigen Repository gesichert:

- Archiv-Branch: `archive/v1-original-2026-10-03`
- Exakter Commit: `376ac3dfcc89d6825f5d9330c0ffc13d61f5b79b`
- GitHub: https://github.com/danielgreuter/Fiona-Matt/tree/archive/v1-original-2026-10-03
- Fester Commit-Link: https://github.com/danielgreuter/Fiona-Matt/tree/376ac3dfcc89d6825f5d9330c0ffc13d61f5b79b

Dieses Archiv nicht weiterentwickeln, nicht verschieben und nicht löschen. Weitere Änderungen erfolgen ausschliesslich in Arbeitsbranches. Die laufende Version auf `main` bleibt durch diesen V2-Designumbau unverändert.

## Wiederherstellung

Der Commit enthält den vollständigen damaligen App-Code, das Originaldesign, Bilder/Logos, Scraper, Workflows und den damaligen repositorybasierten Datenbestand. Für einen lokalen exakten Vergleich:

```bash
git fetch origin
git worktree add --detach ../Fiona-Matt-V1 376ac3dfcc89d6825f5d9330c0ffc13d61f5b79b
```

Für eine spätere Rückkehr der veröffentlichten App können die gewünschten App-Dateien aus diesem Archiv in einem separaten Restore-Branch übernommen und als eigener Pull Request geprüft werden. Keinen Force-Push und keinen History-Reset von `main` verwenden. Damit bleiben auch spätere Verbesserungen nachvollziehbar.

Zusätzlich ist die Originaloberfläche innerhalb von V2 weiterhin über `legacy.html` erreichbar. Der Archiv-Commit ist die vollständige Sicherung; `legacy.html` ist die direkte Übergangsansicht.

Cloudflare Worker, KV und andere externe Dienste werden durch diese Git-Sicherung nicht zeitlich eingefroren. Ihre Konfiguration und laufenden Datenpfade bleiben bei diesem Designumbau unverändert.
