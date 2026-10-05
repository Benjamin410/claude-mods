# claude-mods

Eigene Claude-Code-Mods (Plugins mit Function-Hooks), privat geteilt ueber alle Geraete.
Das Repo ist zugleich ein Plugin-Marketplace (`.claude-plugin/marketplace.json`).

## Einrichten auf einem Geraet

```sh
git clone git@github.com:<dein-user>/claude-mods.git ~/claude-mods
~/claude-mods/install.sh
```

Aktualisieren: `git -C ~/claude-mods pull`, danach in einer laufenden Sitzung `/reload-plugins`.

Nur fuer eine Sitzung testen, ohne Installation: `claude --plugin-dir ~/claude-mods/mods/token-usage`.
Fuer Desktop-App/SDK-Sitzungen alternativ `CLAUDE_CODE_PLUGIN_DIRS` im `env`-Block von
`~/.claude/settings.json` auf die Mod-Ordner setzen.

## Mods

### token-usage

Zeigt den Token-Verbrauch der letzten 7 Tage im Vergleich zur Plan-Auslastung.

- `/tokens` oeffnet ein Pane: Balken je Tag, Summe (ohne/mit Cache-Reads), Aufteilung
  Input/Output/Cache, Verbrauch je Modell.
- Plan-Auslastung: 5-Stunden- und 7-Tage-Fenster in Prozent mit Reset-Zeitpunkt, so wie die
  letzte API-Antwort sie meldet (nur mit Abo-Login, nicht mit API-Key). Der letzte Stand wird
  sitzungsuebergreifend gespeichert.
- Vergleich: Tokens seit Beginn des aktuellen 7-Tage-Plan-Fensters gegen dessen Prozentwert,
  daraus Tokens je 1 % und eine Hochrechnung bis 100 %.
- Statuszeile: `7T: <Tokens> Tok · Plan 7T <n>%`, alle 10 Minuten neu eingelesen.

Grenzen:

- Tokens stammen aus den lokalen Transkripten (`~/.claude/projects/**/*.jsonl`, bzw.
  `$CLAUDE_CONFIG_DIR`) dieses Geraets. Der Plan-Prozentwert zaehlt dagegen alle Geraete und
  Oberflaechen (claude.ai, Cloud-Sitzungen). Die Hochrechnung ist daher eine Untergrenze/Schaetzung.
- Der Plan gewichtet Modelle und Cache-Tokens anders als eine reine Token-Summe; als
  Vergleichsbasis dienen Tokens ohne Cache-Reads.
- Transkripte ueber 4 MiB werden per `grep` gefiltert gelesen (unter Windows ohne grep uebersprungen).

Pruefen: `claude plugin validate mods/token-usage` und `claude plugin test mods/token-usage`.
