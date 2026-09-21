#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$project_dir/dist"

rm -rf "$build_dir"
mkdir -p "$build_dir/client/assets" "$build_dir/server"

cp "$project_dir/index.html" "$build_dir/client/index.html"
cp "$project_dir/styles.css" "$build_dir/client/styles.css"
cp "$project_dir/app.js" "$build_dir/client/app.js"
cp "$project_dir/gemini.js" "$build_dir/client/gemini.js"
cp "$project_dir/lookup.js" "$build_dir/client/lookup.js"
cp "$project_dir/assets/hirepath-logo.png" "$build_dir/client/assets/hirepath-logo.png"
cp "$project_dir/assets/og.png" "$build_dir/client/assets/og.png"
cp "$project_dir/server/index.js" "$build_dir/server/index.js"

printf 'Built HirePath for Sites at %s\n' "$build_dir"
