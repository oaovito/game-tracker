#!/usr/bin/env bash
# Constroi o aplicativo de iOS (docs/celular/ios/build/trackeroao.ipa) num Mac com o Xcode,
# sem projeto do Xcode: swiftc compila, actool monta o icone, e o .ipa e o
# pacote Payload/Trackeroao.app zipado. O .ipa sai sem assinatura; quem
# instala (AltStore, SideStore) assina no proprio aparelho.
#
#   VERSAO=1.8.6 bash docs/celular/ios/construir.sh
set -euo pipefail
cd "$(dirname "$0")"
VERSAO="${VERSAO:-0.0.0}"
rm -rf build
APP=build/Payload/Trackeroao.app
mkdir -p "$APP"

xcrun -sdk iphoneos swiftc -parse-as-library -O \
  -target arm64-apple-ios15.0 \
  -o "$APP/Trackeroao" src/*.swift

sed "s/VERSAO/$VERSAO/g" Info.plist > "$APP/Info.plist"

xcrun actool Assets.xcassets --compile "$APP" --platform iphoneos \
  --minimum-deployment-target 15.0 --app-icon AppIcon \
  --target-device iphone --target-device ipad \
  --output-partial-info-plist build/icone.plist >/dev/null
# As chaves do icone que o actool gera entram no Info.plist do aplicativo.
python3 - "$APP/Info.plist" build/icone.plist <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as f: info = plistlib.load(f)
with open(sys.argv[2], 'rb') as f: info.update(plistlib.load(f))
with open(sys.argv[1], 'wb') as f: plistlib.dump(info, f)
PY
plutil -lint "$APP/Info.plist"

(cd build && zip -qry trackeroao.ipa Payload)
test -s build/trackeroao.ipa
echo "docs/celular/ios/build/trackeroao.ipa: $(wc -c < build/trackeroao.ipa) bytes"
