#!/bin/bash
# Installe les agents launchd du Mac : le relais de Mafe (toutes les 5 minutes) et Kuroro (boucle permanente,
# il fait parler le modèle local d'Ollama pour la page du QG). « bash mac/installer.sh kuroro » : Kuroro seul.
set -euo pipefail
DEPOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)" || { echo "node introuvable" >&2; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
installer() { # $1 : nom (relais, kuroro)
  local CIBLE="$HOME/Library/LaunchAgents/fr.qg.$1.plist" JOURNAL="$HOME/Library/Logs/qg-$1.log"
  sed -e "s|__NODE__|$NODE|g" -e "s|__DEPOT__|$DEPOT|g" -e "s|__JOURNAL__|$JOURNAL|g" "$DEPOT/mac/fr.qg.$1.plist" > "$CIBLE"
  launchctl bootout "gui/$(id -u)" "$CIBLE" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$CIBLE"
  echo "$1 installé ($CIBLE). Journal : $JOURNAL"
}
for nom in "${@:-relais kuroro}"; do for n in $nom; do installer "$n"; done; done
