#!/usr/bin/env bash
# Publish HirePath to GitHub Pages.
#
#   /           marketing landing page
#   /blog.html  blog article
#   /app/       the HirePath application
#
# Safe to re-run: it creates the repository the first time and just
# redeploys on every run after that.
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

repo_name="hirepath"
owner="$(gh api user --jq .login)"
slug="$owner/$repo_name"

echo "==> Building"
bash scripts/build-pages.sh

if ! gh repo view "$slug" >/dev/null 2>&1; then
  echo "==> Creating public repository $slug"
  gh repo create "$repo_name" --public \
    --description "HirePath — turn a job advertisement into an application checklist and a day-by-day preparation plan."
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/$slug.git"
fi

echo "==> Pushing source to main"
git push -u origin main

echo "==> Publishing the built site to gh-pages"
tmp="$(mktemp -d)"
cp -R dist/pages/. "$tmp/"
cp -R dist/pages/.nojekyll "$tmp/.nojekyll" 2>/dev/null || true
(
  cd "$tmp"
  git init -q
  git checkout -q -B gh-pages
  git add -A
  git -c user.email="$(git -C "$project_dir" config user.email)" \
      -c user.name="$(git -C "$project_dir" config user.name)" \
      commit -q -m "Deploy HirePath"
  git push -q -f "https://github.com/$slug.git" gh-pages
)
rm -rf "$tmp"

echo "==> Enabling GitHub Pages"
gh api -X POST "repos/$slug/pages" \
  -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$slug/pages" \
       -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 \
  || true

echo
echo "Done. Your site will be live in about a minute at:"
echo "  https://$owner.github.io/$repo_name/"
echo "  https://$owner.github.io/$repo_name/app/#/dashboard"
