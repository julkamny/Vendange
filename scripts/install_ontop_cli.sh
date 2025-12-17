#!/usr/bin/env bash
set -euo pipefail

VERSION="${ONTOP_VERSION:-5.0.0}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${ROOT_DIR}/.tools/ontop-cli/${VERSION}"
PG_JDBC_VERSION="${POSTGRES_JDBC_VERSION:-42.7.4}"
PG_JAR="postgresql-${PG_JDBC_VERSION}.jar"
PG_JAR_PATH="${DEST_DIR}/jdbc/${PG_JAR}"

if [[ -x "${DEST_DIR}/ontop" && -f "${PG_JAR_PATH}" ]]; then
  echo "Ontop CLI already installed at ${DEST_DIR}"
  exit 0
fi

mkdir -p "${DEST_DIR}"

ZIP_URL="https://github.com/ontop/ontop/releases/download/ontop-${VERSION}/ontop-cli-${VERSION}.zip"
TMP_ZIP="$(mktemp -t "ontop-cli-${VERSION}.XXXXXX.zip")"

cleanup() {
  rm -f "${TMP_ZIP}"
}
trap cleanup EXIT

echo "Downloading ${ZIP_URL}"
curl -L --fail "${ZIP_URL}" -o "${TMP_ZIP}"

echo "Extracting to ${DEST_DIR}"
unzip -q -o "${TMP_ZIP}" -d "${DEST_DIR}"

if [[ ! -f "${PG_JAR_PATH}" ]]; then
  echo "Downloading Postgres JDBC driver ${PG_JDBC_VERSION}"
  mkdir -p "${DEST_DIR}/jdbc"
  curl -L --fail "https://repo1.maven.org/maven2/org/postgresql/postgresql/${PG_JDBC_VERSION}/${PG_JAR}" -o "${PG_JAR_PATH}"
fi

if [[ -x "${DEST_DIR}/ontop" ]]; then
  echo "Done. Export ONTOP_CLI=${DEST_DIR}/ontop"
  exit 0
fi

if [[ -x "${DEST_DIR}/bin/ontop" ]]; then
  echo "Done. Export ONTOP_CLI=${DEST_DIR}/bin/ontop"
  exit 0
fi

echo "Install succeeded but ontop executable not found in ${DEST_DIR}" >&2
exit 1
