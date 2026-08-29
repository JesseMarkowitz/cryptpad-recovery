#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PACKAGE_VERSION=$(node -p "require('$REPOSITORY_ROOT/package.json').version")
NODE_RELEASE=v16.19.0
NODE_PACKAGE="node-$NODE_RELEASE-linux-x64"
NODE_ARCHIVE="$NODE_PACKAGE.tar.xz"
NODE_DIST_URL="https://nodejs.org/dist/$NODE_RELEASE"
PINNED_NODE_ARCHIVE_SHA256=c88b52497ab38a3ddf526e5b46a41270320409109c3f74171b241132984fd08f
OUTPUT_DIRECTORY="$REPOSITORY_ROOT/dist"
ALLOW_DIRTY=false

if [ "${1:-}" = "--allow-dirty" ]; then
    ALLOW_DIRTY=true
elif [ -n "${1:-}" ]; then
    echo "Usage: scripts/build-release.sh [--allow-dirty]" >&2
    exit 2
fi

if [ "$ALLOW_DIRTY" = false ] && [ -n "$(git -C "$REPOSITORY_ROOT" status --porcelain)" ]; then
    echo "Refusing to build a release from a dirty worktree. Commit changes first." >&2
    exit 1
fi

TEMPORARY_DIRECTORY=$(mktemp -d)
cleanup() {
    rm -rf -- "$TEMPORARY_DIRECTORY"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$OUTPUT_DIRECTORY"
curl --fail --location --silent --show-error \
    "$NODE_DIST_URL/SHASUMS256.txt" \
    --output "$TEMPORARY_DIRECTORY/SHASUMS256.txt"
curl --fail --location --silent --show-error \
    "$NODE_DIST_URL/$NODE_ARCHIVE" \
    --output "$TEMPORARY_DIRECTORY/$NODE_ARCHIVE"

EXPECTED_NODE_SUM=$(awk -v archive="$NODE_ARCHIVE" '$2 == archive { print $1 }' "$TEMPORARY_DIRECTORY/SHASUMS256.txt")
if [ -z "$EXPECTED_NODE_SUM" ]; then
    echo "The Node checksum manifest did not contain $NODE_ARCHIVE." >&2
    exit 1
fi
if [ "$EXPECTED_NODE_SUM" != "$PINNED_NODE_ARCHIVE_SHA256" ]; then
    echo "The upstream checksum manifest does not match the pinned Node archive checksum." >&2
    exit 1
fi
ACTUAL_NODE_SUM=$(sha256sum "$TEMPORARY_DIRECTORY/$NODE_ARCHIVE" | awk '{ print $1 }')
if [ "$PINNED_NODE_ARCHIVE_SHA256" != "$ACTUAL_NODE_SUM" ]; then
    echo "The downloaded Node archive failed SHA-256 verification." >&2
    exit 1
fi

tar -xJf "$TEMPORARY_DIRECTORY/$NODE_ARCHIVE" -C "$TEMPORARY_DIRECTORY"

BUNDLE_NAME="cryptpad-recovery-$PACKAGE_VERSION-linux-x64"
BUNDLE_ROOT="$TEMPORARY_DIRECTORY/$BUNDLE_NAME"
mkdir -p "$BUNDLE_ROOT/app/bin" "$BUNDLE_ROOT/app/src" "$BUNDLE_ROOT/app/vendor" "$BUNDLE_ROOT/runtime/bin"

cp "$REPOSITORY_ROOT/cryptpad-recover" "$BUNDLE_ROOT/cryptpad-recover"
cp "$REPOSITORY_ROOT/bin/cryptpad-recover.js" "$BUNDLE_ROOT/app/bin/cryptpad-recover.js"
cp "$REPOSITORY_ROOT/src/recovery.js" "$BUNDLE_ROOT/app/src/recovery.js"
cp "$REPOSITORY_ROOT/src/support-log.js" "$BUNDLE_ROOT/app/src/support-log.js"
cp "$REPOSITORY_ROOT/package.json" "$BUNDLE_ROOT/app/package.json"
cp -R "$REPOSITORY_ROOT/vendor/." "$BUNDLE_ROOT/app/vendor/"
cp "$REPOSITORY_ROOT/STANDALONE.md" "$BUNDLE_ROOT/README.txt"
cp "$TEMPORARY_DIRECTORY/$NODE_PACKAGE/bin/node" "$BUNDLE_ROOT/runtime/bin/node"
cp "$TEMPORARY_DIRECTORY/$NODE_PACKAGE/LICENSE" "$BUNDLE_ROOT/runtime/NODE-LICENSE"

SOURCE_COMMIT=$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)
DIRTY=false
if [ -n "$(git -C "$REPOSITORY_ROOT" status --porcelain)" ]; then DIRTY=true; fi
printf '{\n  "version": "%s",\n  "commit": "%s",\n  "dirty": %s,\n  "nodeVersion": "%s",\n  "nodeArchiveSha256": "%s"\n}\n' \
    "$PACKAGE_VERSION" "$SOURCE_COMMIT" "$DIRTY" "$NODE_RELEASE" "$ACTUAL_NODE_SUM" \
    > "$BUNDLE_ROOT/app/BUILD_INFO.json"

chmod 0755 "$BUNDLE_ROOT/cryptpad-recover" "$BUNDLE_ROOT/app/bin/cryptpad-recover.js" "$BUNDLE_ROOT/runtime/bin/node"
(
    cd "$BUNDLE_ROOT"
    find . -type f ! -name MANIFEST.sha256 -print0 \
        | sort -z \
        | xargs -0 sha256sum \
        > MANIFEST.sha256
)

ARCHIVE_PATH="$OUTPUT_DIRECTORY/$BUNDLE_NAME.tar.gz"
tar -czf "$ARCHIVE_PATH" -C "$TEMPORARY_DIRECTORY" "$BUNDLE_NAME"
(
    cd "$OUTPUT_DIRECTORY"
    sha256sum "$BUNDLE_NAME.tar.gz" > "$BUNDLE_NAME.tar.gz.sha256"
)

echo "Built $ARCHIVE_PATH"
echo "Built $ARCHIVE_PATH.sha256"
