#!/usr/bin/env bash
#
# construir.sh - gera android/build/trackeroao.apk assinado, sem Gradle.
#
# Usa só as ferramentas de linha de comando do SDK: aapt2, javac, d8,
# zipalign e apksigner. O runner ubuntu-latest do GitHub já vem com elas; em
# outra máquina basta ANDROID_HOME apontar para um SDK com build-tools e uma
# plataforma 34 ou mais nova.
#
# Assinatura, pelo ambiente:
#   ANDROID_KEYSTORE       caminho do keystore
#   ANDROID_KEYSTORE_PASS  senha (do keystore e da chave)
#   ANDROID_KEY_ALIAS      alias da chave
# Sem ANDROID_KEYSTORE, assina com uma chave descartável: o APK instala, mas
# a próxima versão não instala por cima dele (a assinatura muda).

set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAIDA="$AQUI/build"
PLATAFORMA_MIN=34

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  echo "erro: defina ANDROID_HOME (ou ANDROID_SDK_ROOT) apontando para o SDK do Android" >&2
  exit 1
fi

# A versão mais nova instalada de cada coisa, sem nome fixo no script: o
# runner troca de versão sem avisar.
BT_VER="$(ls -1 "$SDK/build-tools" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -n 1 || true)"
if [ -z "$BT_VER" ]; then
  echo "erro: nenhuma build-tools em $SDK/build-tools" >&2
  exit 1
fi
BT="$SDK/build-tools/$BT_VER"

API="$(ls -1 "$SDK/platforms" 2>/dev/null | sed -n 's/^android-\([0-9][0-9]*\)$/\1/p' | sort -n | tail -n 1 || true)"
if [ -z "$API" ] || [ "$API" -lt "$PLATAFORMA_MIN" ]; then
  echo "erro: preciso de platforms/android-$PLATAFORMA_MIN ou mais nova em $SDK (achei: ${API:-nenhuma})" >&2
  exit 1
fi
ANDROID_JAR="$SDK/platforms/android-$API/android.jar"

for f in aapt2 d8 zipalign apksigner; do
  [ -x "$BT/$f" ] || { echo "erro: $BT/$f não existe" >&2; exit 1; }
done
command -v javac >/dev/null || { echo "erro: javac não encontrado (precisa de um JDK)" >&2; exit 1; }
command -v zip >/dev/null || { echo "erro: zip não encontrado" >&2; exit 1; }

# A versão do aplicativo acompanha a do projeto (package.json na raiz).
# Na release, quem chama passa VERSAO (a da tag); sem ela, vale o package.json.
VERSAO="${VERSAO:-$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([0-9.]*\)".*/\1/p' "$AQUI/../package.json" | head -n 1)}"
VERSAO="${VERSAO:-1.0.0}"
IFS=. read -r V_MAIOR V_MENOR V_CORR <<<"$VERSAO"
CODIGO=$(( ${V_MAIOR:-1} * 10000 + ${V_MENOR:-0} * 100 + ${V_CORR:-0} ))

echo "SDK: build-tools $BT_VER, android-$API | versão $VERSAO ($CODIGO)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/gen" "$TMP/classes" "$TMP/dex" "$SAIDA"

# 1. recursos: compila, e liga com o manifesto num APK sem código ainda
"$BT/aapt2" compile --dir "$AQUI/res" -o "$TMP/res.zip"
"$BT/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest "$AQUI/AndroidManifest.xml" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code "$CODIGO" \
  --version-name "$VERSAO" \
  --java "$TMP/gen" \
  -o "$TMP/base.apk" \
  "$TMP/res.zip"

# 2. Java -> .class. Bytecode 8, que o d8 converte sem surpresa; android.jar
# no lugar da biblioteca do JDK, para não compilar contra o que o telefone
# não tem.
mapfile -t FONTES < <(find "$AQUI/src" "$TMP/gen" -name '*.java')
javac -encoding UTF-8 -source 1.8 -target 1.8 -Xlint:-options -nowarn \
  -bootclasspath "$ANDROID_JAR" \
  -d "$TMP/classes" \
  "${FONTES[@]}"

# 3. .class -> classes.dex
mapfile -t CLASSES < <(find "$TMP/classes" -name '*.class')
"$BT/d8" --release --min-api 24 --lib "$ANDROID_JAR" --output "$TMP/dex" "${CLASSES[@]}"

# 4. junta o dex ao APK, alinha e assina
cp "$TMP/base.apk" "$TMP/sem-assinatura.apk"
zip -q -j "$TMP/sem-assinatura.apk" "$TMP/dex/classes.dex"
"$BT/zipalign" -p -f 4 "$TMP/sem-assinatura.apk" "$TMP/alinhado.apk"

if [ -n "${ANDROID_KEYSTORE:-}" ]; then
  : "${ANDROID_KEYSTORE_PASS:?defina ANDROID_KEYSTORE_PASS}"
  : "${ANDROID_KEY_ALIAS:?defina ANDROID_KEY_ALIAS}"
  KS="$ANDROID_KEYSTORE"
  ALIAS="$ANDROID_KEY_ALIAS"
else
  echo "aviso: ANDROID_KEYSTORE não definido; assinando com chave descartável." >&2
  echo "aviso: uma versão futura assinada com outra chave NÃO instala por cima desta." >&2
  KS="$TMP/descartavel.jks"
  ALIAS="trackeroao"
  export ANDROID_KEYSTORE_PASS="descartavel"
  keytool -genkeypair -noprompt -keystore "$KS" -storetype PKCS12 \
    -storepass "$ANDROID_KEYSTORE_PASS" -keypass "$ANDROID_KEYSTORE_PASS" \
    -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Trackeroao" >/dev/null 2>&1
fi

# A senha vai pelo ambiente, não pela linha de comando (que aparece no ps).
"$BT/apksigner" sign \
  --ks "$KS" \
  --ks-key-alias "$ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASS \
  --key-pass env:ANDROID_KEYSTORE_PASS \
  --out "$SAIDA/trackeroao.apk" \
  "$TMP/alinhado.apk"
rm -f "$SAIDA/trackeroao.apk.idsig"

"$BT/apksigner" verify "$SAIDA/trackeroao.apk"
echo "pronto: $SAIDA/trackeroao.apk ($(wc -c < "$SAIDA/trackeroao.apk") bytes)"
