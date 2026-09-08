#!/usr/bin/env bash
# Load the external plugin monorepo in an isolated home, then open every pane it contributes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_REPO="${GLOOM_QA_PLUGIN_REPO:-$(cd "$ROOT/.." && pwd)/gloomberb-plugins}"
HOME_DIR="${GLOOM_QA_HOME:-$(mktemp -d "${TMPDIR:-/tmp}/gloom-plugin-qa-home.XXXXXX")}"
SESSION="${GLOOM_QA_SESSION:-gloom-plugin-qa}"
OWNS_HOME=0

if [[ "$HOME_DIR" == *"/gloom-plugin-qa-home."* ]]; then
  OWNS_HOME=1
fi

cleanup() {
  pilotty kill -s "$SESSION" >/dev/null 2>&1 || true
  if [ "$OWNS_HOME" = "1" ]; then
    rm -rf "$HOME_DIR"
  fi
}
trap cleanup EXIT

if [ ! -d "$PLUGIN_REPO/plugins" ]; then
  echo "qa-plugins: plugin monorepo not found at $PLUGIN_REPO" >&2
  exit 1
fi

mkdir -p "$HOME_DIR/.gloomberb/plugins"
ln -s "$PLUGIN_REPO" "$HOME_DIR/.gloomberb/plugins/gloomberb-plugins"

CATALOG="$(
  cd "$ROOT"
  HOME="$HOME_DIR" bun -e '
    import { loadExternalPlugins } from "./src/plugins/loader";
    const loaded = await loadExternalPlugins("tui");
    const failures = loaded.filter((entry) => entry.error);
    if (failures.length) {
      for (const entry of failures) console.error(`${entry.plugin.id}: ${entry.error}`);
      process.exit(1);
    }
    const paneIds = loaded.flatMap((entry) => entry.plugin.panes?.map((pane) => pane.id) ?? []);
    const noPane = loaded.filter((entry) => !entry.plugin.panes?.length).map((entry) => entry.plugin.id);
    console.log(JSON.stringify({
      pluginCount: loaded.length,
      paneIds: [...new Set(paneIds)].sort(),
      registrationOnly: noPane.sort(),
    }));
  '
)"

PLUGIN_COUNT="$(bun -e 'console.log(JSON.parse(process.argv[1]).pluginCount)' "$CATALOG")"
PANE_IDS="$(bun -e 'console.log(JSON.parse(process.argv[1]).paneIds.join(","))' "$CATALOG")"
REGISTRATION_ONLY="$(bun -e 'console.log(JSON.parse(process.argv[1]).registrationOnly.join(", "))' "$CATALOG")"

echo "qa-plugins: loaded $PLUGIN_COUNT external plugins"
echo "qa-plugins: pane coverage $PANE_IDS"
echo "qa-plugins: registration-only $REGISTRATION_ONLY"

if [ "$PLUGIN_COUNT" -eq 0 ] || [ -z "$PANE_IDS" ]; then
  echo "qa-plugins: no external plugin panes discovered" >&2
  exit 1
fi

GLOOM_QA_HOME="$HOME_DIR" \
GLOOM_QA_SESSION="$SESSION" \
bash "$ROOT/scripts/qa-panes.sh" --only "$PANE_IDS"
