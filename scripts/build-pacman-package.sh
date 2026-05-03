#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir=""
output_dir="$repo_root/dist/pacman"
package_root="$repo_root/.cache/pacman/codex-linux"

usage() {
  cat <<'EOF'
Usage: scripts/build-pacman-package.sh [--build-dir <path>] [--output-dir <path>]

Build a local Arch/Omarchy pacman package from an existing prod Linux build.

Defaults:
  --build-dir   newest dist/codex-linux-prod-* directory
  --output-dir  dist/pacman
EOF
}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

abs_path() {
  local path="$1"
  if [ -d "$path" ]; then
    (cd "$path" && pwd -P)
  else
    mkdir -p "$(dirname "$path")"
    printf '%s/%s\n' "$(cd "$(dirname "$path")" && pwd -P)" "$(basename "$path")"
  fi
}

shell_quote() {
  printf '%q' "$1"
}

resolve_package_path() {
  local path="$1"
  case "$path" in
    /*) printf '%s\n' "$path" ;;
    *) printf '%s/%s\n' "$package_root" "$path" ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build-dir)
      [ "$#" -ge 2 ] || fail "--build-dir requires a path"
      build_dir="$2"
      shift 2
      ;;
    --output-dir)
      [ "$#" -ge 2 ] || fail "--output-dir requires a path"
      output_dir="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ "$(uname -m)" = "x86_64" ] || fail "pacman package builds are supported only on x86_64 hosts"
command -v makepkg >/dev/null 2>&1 || fail "makepkg is required. Install base-devel on Arch/Omarchy."

if [ -z "$build_dir" ]; then
  if [ -d "$repo_root/dist" ]; then
    build_dir="$(
      find "$repo_root/dist" -maxdepth 1 -type d -name 'codex-linux-prod-*' 2>/dev/null \
        | LC_ALL=C sort -V \
        | tail -n 1
    )"
  fi
fi

[ -n "$build_dir" ] || fail "no prod build found. Run: make build"
[ -d "$build_dir" ] || fail "build directory not found: $build_dir"

build_dir="$(abs_path "$build_dir")"
output_dir="$(abs_path "$output_dir")"
metadata="$build_dir/resources/codex-linux-build.json"

[ -f "$build_dir/codex-linux" ] || fail "missing launcher: $build_dir/codex-linux"
[ -f "$metadata" ] || fail "missing build metadata: $metadata"

read_metadata() {
  local expression="$1"
  node -e '
const fs = require("fs");
const metadataPath = process.argv[1];
const expression = process.argv[2];
const data = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const value = expression.split(".").reduce((current, key) => current && current[key], data);
if (typeof value !== "string" || value.length === 0) process.exit(1);
process.stdout.write(value);
' "$metadata" "$expression"
}

package_version="$(read_metadata packageVersion)" || fail "metadata does not contain packageVersion"
appcast_build="$(read_metadata source.build)" || fail "metadata does not contain source.build"
source_url="$(read_metadata source.url)" || fail "metadata does not contain source.url"
pkgver="${package_version}.${appcast_build}"

case "$pkgver" in
  *[!A-Za-z0-9._+~-]*|'') fail "metadata produced invalid pkgver: $pkgver" ;;
esac

rm -rf "$package_root"
mkdir -p "$package_root" "$output_dir"

quoted_build_dir="$(shell_quote "$build_dir")"
quoted_source_url="$(shell_quote "$source_url")"

cat >"$package_root/PKGBUILD" <<EOF
pkgname=codex-linux
pkgver=$pkgver
pkgrel=1
pkgdesc='Local Linux conversion of the OpenAI Codex desktop app'
arch=('x86_64')
url='https://github.com/openai/codex'
license=('custom')
depends=(
  'openai-codex'
  'alsa-lib'
  'c-ares'
  'gcc-libs'
  'glibc'
  'gtk3'
  'libgtk-3.so=0-64'
  'libevent'
  'libffi'
  'libffi.so=8-64'
  'libpulse'
  'libpulse.so=0-64'
  'nss'
  'zlib'
  'libz.so=1-64'
  'fontconfig'
  'libfontconfig.so=1-64'
  'brotli'
  'libjpeg-turbo'
  'libjpeg.so=8-64'
  'flac'
  'libFLAC.so=14-64'
  'libdrm'
  'libxml2'
  'libxml2.so=16-64'
  'minizip'
  'opus'
  'libopus.so=0-64'
  'harfbuzz'
  'libharfbuzz.so=0-64'
  'libharfbuzz-subset.so=0-64'
  'libxslt'
  'libxslt.so=1-64'
  'freetype2'
  'libfreetype.so=6-64'
)
options=('!strip' '!debug')
source=()
sha256sums=()

_codex_source_build=$quoted_build_dir
_codex_upstream_source=$quoted_source_url

package() {
  install -d "\$pkgdir/opt"
  cp -a "\$_codex_source_build" "\$pkgdir/opt/codex-linux"

  rm -f "\$pkgdir/opt/codex-linux/codex-linux.desktop"
  rm -rf "\$pkgdir/opt/codex-linux/.cache"

  install -Dm755 /dev/stdin "\$pkgdir/usr/bin/codex-linux" <<'WRAPPER'
#!/usr/bin/env bash
set -Eeuo pipefail
exec /opt/codex-linux/codex-linux "\$@"
WRAPPER

  install -Dm644 /dev/stdin "\$pkgdir/usr/share/applications/codex-linux.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Codex
Comment=OpenAI Codex desktop app converted locally for Linux
Exec=/usr/bin/codex-linux %U
Terminal=false
Categories=Development;IDE;
MimeType=x-scheme-handler/codex;
DESKTOP

  install -Dm644 /dev/stdin "\$pkgdir/usr/share/licenses/codex-linux/LICENSE" <<LICENSE
This is a local, unofficial package produced from a locally converted OpenAI
Codex desktop app artifact.

Upstream source archive:
\$_codex_upstream_source

This package is intended for local installation only and does not grant rights
to redistribute OpenAI-derived application artifacts.
LICENSE
}
EOF

mapfile -t expected_pkg_files < <(
  cd "$package_root"
  makepkg --packagelist
)

[ "${#expected_pkg_files[@]}" -gt 0 ] || fail "makepkg did not report an expected package path"

(
  cd "$package_root"
  makepkg --force --clean --cleanbuild --nodeps --noconfirm
)

pkg_file=""
for expected_pkg_file in "${expected_pkg_files[@]}"; do
  candidate_pkg_file="$(resolve_package_path "$expected_pkg_file")"
  if [ -f "$candidate_pkg_file" ]; then
    pkg_file="$candidate_pkg_file"
    break
  fi
done

[ -n "$pkg_file" ] || fail "makepkg completed without producing expected package: ${expected_pkg_files[*]}"

pkg_basename="$(basename "$pkg_file")"
find "$output_dir" -maxdepth 1 -type f -name 'codex-linux-*.pkg.tar*' ! -name "$pkg_basename" -delete

if [ "$(abs_path "$pkg_file")" != "$output_dir/$pkg_basename" ]; then
  cp -f "$pkg_file" "$output_dir/"
fi

printf 'Built pacman package: %s\n' "$output_dir/$pkg_basename"
