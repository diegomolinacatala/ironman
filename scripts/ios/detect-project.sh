#!/usr/bin/env bash
# Tras `expo prebuild`: imprime workspace=… y scheme=… para $GITHUB_OUTPUT.
# El nombre lo deriva Expo del nombre de la app ("Road to Ironman" → RoadtoIronman).
set -euo pipefail

workspace=$(ls -d ios/*.xcworkspace 2>/dev/null | head -n 1)
if [ -z "$workspace" ]; then
  echo "::error::No se encontró ios/*.xcworkspace: ¿falló expo prebuild o pod install?" >&2
  exit 1
fi
scheme=$(basename "$workspace" .xcworkspace)
echo "Workspace: $workspace · esquema: $scheme" >&2
echo "workspace=$workspace"
echo "scheme=$scheme"
