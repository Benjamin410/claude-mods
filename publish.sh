#!/usr/bin/env sh
# Einmalig: legt das private GitHub-Repo an und pusht diesen Stand (braucht gh, eingeloggt).
set -e
cd "$(dirname "$0")"
gh repo create claude-mods --private --source . --remote origin --push \
  --description "Eigene Claude Code Mods, geteilt ueber alle Geraete"
