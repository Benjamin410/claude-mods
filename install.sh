#!/usr/bin/env sh
# Registriert dieses Repo als lokalen Marketplace und installiert alle Mods.
# Da der Marketplace ein Ordner ist, liest Claude Code die Mods direkt aus
# diesem Checkout: Aktualisieren = `git pull` und in der Sitzung `/reload-plugins`.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
claude plugin marketplace add "$DIR"
for m in "$DIR"/mods/*/; do
  claude plugin install "$(basename "$m")@claude-mods"
done
echo "Fertig. In laufenden Sitzungen: /reload-plugins"
