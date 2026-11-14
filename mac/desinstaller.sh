#!/bin/bash
# Retire les agents launchd du Mac (relais de Mafe, Kuroro).
set -euo pipefail
for nom in ${@:-relais kuroro}; do
  CIBLE="$HOME/Library/LaunchAgents/fr.qg.$nom.plist"
  launchctl bootout "gui/$(id -u)" "$CIBLE" 2>/dev/null || true
  rm -f "$CIBLE"
  echo "$nom retiré."
done
