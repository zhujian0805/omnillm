#!/usr/bin/env bash
# scripts/release.sh — Automate version bumping, tagging, and releasing
#
# Usage:
#   ./scripts/release.sh              # Auto-bump (patch by default)
#   ./scripts/release.sh patch        # v0.0.1 → v0.0.2
#   ./scripts/release.sh minor        # v0.0.2 → v0.1.0
#   ./scripts/release.sh major        # v0.1.0 → v1.0.0
#   ./scripts/release.sh v0.5.0       # Set explicit version
#
# What it does:
#   1. Validates no uncommitted changes
#   2. Computes next version from VERSION file (or uses explicit version)
#   3. Writes new version to VERSION file
#   4. Creates annotated git tag
#   5. Pushes commit + tag to remote

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$REPO_ROOT/VERSION"

# ── Helpers ──────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

bump_version() {
  local current="$1" part="$2"
  # Strip leading 'v'
  current="${current#v}"
  IFS='.' read -r major minor patch <<< "$current"

  case "$part" in
    major) major=$((major + 1)); minor=0; patch=0 ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    patch) patch=$((patch + 1)) ;;
    *) die "Unknown bump type: $part (use major/minor/patch)" ;;
  esac
  echo "v${major}.${minor}.${patch}"
}

# ── Determine target version ─────────────────────────────────────────────

CURRENT_VERSION="$(cat "$VERSION_FILE" | tr -d '[:space:]')"
[[ -z "$CURRENT_VERSION" ]] && die "VERSION file is empty"

BUMP_TYPE="${1:-patch}"

# Check if user passed an explicit version like "v1.2.3"
if [[ "$BUMP_TYPE" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW_VERSION="$BUMP_TYPE"
  [[ "$NEW_VERSION" != v* ]] && NEW_VERSION="v$NEW_VERSION"
  echo "Setting explicit version: $NEW_VERSION"
else
  NEW_VERSION="$(bump_version "$CURRENT_VERSION" "$BUMP_TYPE")"
  echo "Bumping $BUMP_TYPE: $CURRENT_VERSION → $NEW_VERSION"
fi

# ── Pre-flight checks ───────────────────────────────────────────────────

cd "$REPO_ROOT"

# Check for uncommitted changes
if [[ -n "$(git status --porcelain)" ]]; then
  die "Working tree is dirty. Commit or stash changes before releasing."
fi

# Check if tag already exists locally
if git tag -l "$NEW_VERSION" | grep -q .; then
  die "Tag $NEW_VERSION already exists locally."
fi

# ── Apply changes ────────────────────────────────────────────────────────

# Write VERSION file
printf '%s\n' "$NEW_VERSION" > "$VERSION_FILE"

# Commit
git add "$VERSION_FILE"
git commit -m "release: $NEW_VERSION"

# Tag
git tag -a "$NEW_VERSION" -m "Release $NEW_VERSION"

# ── Push ─────────────────────────────────────────────────────────────────

echo ""
echo "Pushing to remote..."
git push origin master
git push origin "$NEW_VERSION"

echo ""
echo "Done! Released $NEW_VERSION"
echo "  Tag:        $NEW_VERSION"
echo "  VERSION:    $NEW_VERSION"
