#!/usr/bin/env bash
# El archivo de Xcode sale sin firmar (ver ios.yml) y la exportación toma los entitlements de la
# firma de cada binario: sin ellos la app perdería HealthKit, Sign in with Apple, las push y el
# App Group que comparte con los widgets. Firma ad hoc, sin certificado, solo para dejarlos
# escritos; la firma buena la pone la exportación.
# Uso: sign-archive.sh <ruta.xcarchive> <esquema>
set -euo pipefail

archive="$1"
scheme="$2"
app=$(ls -d "$archive"/Products/Applications/*.app | head -n 1)

sign() {
  codesign --force --sign - --timestamp=none --generate-entitlement-der "$@"
}

entitlements_for() {
  # Busca ios/<nombre>/*.entitlements generado por expo prebuild.
  find ios -path "*/$1/*.entitlements" -not -path "*/Pods/*" | head -n 1
}

# De dentro afuera: codesign no firma un paquete con código anidado sin firmar.
while IFS= read -r -d '' item; do
  sign "$item"
done < <(find "$app" -depth \( -name '*.framework' -o -name '*.dylib' \) -print0)

# Extensiones (los widgets de expo-widgets).
while IFS= read -r -d '' appex; do
  name=$(basename "$appex" .appex)
  ent=$(entitlements_for "$name")
  if [ -z "$ent" ]; then
    echo "::error::No hay entitlements para la extensión $name. Ficheros disponibles:"
    find ios -name '*.entitlements' -not -path '*/Pods/*'
    exit 1
  fi
  sign --entitlements "$ent" "$appex"
done < <(find "$app/PlugIns" -maxdepth 1 -name '*.appex' -print0 2>/dev/null)

app_ent=$(entitlements_for "$scheme")
if [ -z "$app_ent" ]; then
  echo "::error::No hay entitlements de la app en ios/$scheme/."
  exit 1
fi
sign --entitlements "$app_ent" "$app"

for bundle in "$app"/PlugIns/*.appex "$app"; do
  [ -e "$bundle" ] || continue
  echo "Entitlements de ${bundle##*/}:"
  codesign -d --entitlements - "$bundle"
done
