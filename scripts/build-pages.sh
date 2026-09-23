#!/usr/bin/env bash
# Build the GitHub Pages tree:
#   /           marketing landing page
#   /blog.html  the blog article
#   /app/       the HirePath application
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$project_dir/dist/pages"

rm -rf "$out"
mkdir -p "$out/assets" "$out/app/assets"

# ---- landing page at the root -------------------------------------------
cp "$project_dir/landing/index.html"  "$out/index.html"
cp "$project_dir/landing/blog.html"   "$out/blog.html"
cp "$project_dir/landing/landing.css" "$out/landing.css"
cp "$project_dir/landing/blog.css"    "$out/blog.css"
cp "$project_dir"/landing/assets/*    "$out/assets/"

# The landing CTAs point at the Netlify copy in source; on Pages the app is
# a sibling directory, so rewrite them to a relative link.
sed -i '' 's#https://heartfelt-hotteok-cab423\.netlify\.app/\#/dashboard#app/\#/dashboard#g' \
  "$out/index.html" "$out/blog.html"
sed -i '' 's#https://heartfelt-hotteok-cab423\.netlify\.app/\##app/\##g' \
  "$out/index.html" "$out/blog.html"

# ---- application under /app/ --------------------------------------------
cp "$project_dir/index.html" "$out/app/index.html"
cp "$project_dir/styles.css" "$out/app/styles.css"
cp "$project_dir/app.js"     "$out/app/app.js"
cp "$project_dir/gemini.js"  "$out/app/gemini.js"
cp "$project_dir/lookup.js"  "$out/app/lookup.js"
cp "$project_dir/assets/hirepath-logo.png" "$out/app/assets/hirepath-logo.png"
cp "$project_dir/assets/og.png"            "$out/app/assets/og.png"

# Pages runs Jekyll by default, which skips files beginning with an underscore.
touch "$out/.nojekyll"

printf 'Built HirePath for GitHub Pages at %s\n' "$out"
