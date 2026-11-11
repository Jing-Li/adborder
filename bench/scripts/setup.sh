#!/bin/bash
# Setup: Download peer skill packs into skills/ directory (read-only, one-time)
# Uses wget + tar (git clone unstable on this host)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Arch/Dx Bench Setup ==="
echo "Downloading peer skill packs (read-only, not installed)..."

# repo: GitHub owner/name | branch: default branch
REPOS=(
  "obra/superpowers|main"
  "mattpocock/skills|main"
  "pbakaus/impeccable|main"
  "Leonxlnx/taste-skill|main"
)

for entry in "${REPOS[@]}"; do
  repo="${entry%%|*}"
  branch="${entry##*|}"
  name=$(basename "$repo")
  target="skills/$name"
  tarball="skills/${name}.tar.gz"

  if [ -d "$target" ] && [ "$(ls -A $target 2>/dev/null)" ]; then
    echo "  ✓ $name already exists, skipping"
    continue
  fi

  echo "  ↓ downloading $repo ($branch)..."
  url="https://github.com/$repo/archive/refs/heads/${branch}.tar.gz"

  # Try main, fallback to master
  if ! wget -q --timeout=30 "$url" -O "$tarball" 2>/dev/null; then
    url="https://github.com/$repo/archive/refs/heads/master.tar.gz"
    if ! wget -q --timeout=30 "$url" -O "$tarball" 2>/dev/null; then
      echo "  ✗ $name — download failed (tried main and master)"
      continue
    fi
  fi

  # Extract (GitHub tarballs have a top-level dir like "repo-branch/")
  mkdir -p "$target"
  tar xzf "$tarball" -C "$target" --strip-components=1
  rm -f "$tarball"
  echo "  ✓ $name extracted ($(find "$target" -name "SKILL.md" | wc -l) skill files)"
done

# Ensure baseline/ exists (empty = no-skill control)
mkdir -p skills/baseline

echo ""
echo "Done. Peer packs in skills/:"
ls skills/ | grep -v mine | grep -v baseline | while read d; do echo "  📦 $d"; done
echo ""
echo "Next: design cases in cases/, then click Run."
