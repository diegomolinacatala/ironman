#!/usr/bin/env bash
# Usa el Xcode estable más reciente del runner (Expo SDK 58 / React Native 0.88 piden uno moderno).
set -euo pipefail

echo "Xcode disponibles:"
ls -d /Applications/Xcode*.app 2>/dev/null || true

latest=$(ls -d /Applications/Xcode_*.app 2>/dev/null | grep -viE 'beta|rc' | sort -V | tail -n 1 || true)
if [ -n "$latest" ]; then
  sudo xcode-select -s "$latest/Contents/Developer"
fi
xcodebuild -version
