#!/usr/bin/env bash
# install.sh — install the NativeUI *skill set* for OpenAI Codex.
#
# Codex skills are a portable, cross-agent standard: a folder containing a
# SKILL.md (name + description frontmatter) plus its reference docs/examples,
# dropped into a Codex skills directory. The SAME skills the Claude Code plugin
# ships (nativeui-plugin/skills/*) ARE valid Codex skills — so this installer
# does NOT duplicate them. It COPIES every shared skill + the shared pure-Node
# toolchain into the Codex skills dir and rewrites the copies so the
# tool/reference paths resolve under Codex (which does NOT set CLAUDE_SKILL_DIR).
#
# The plugin ships a discovered set of skills (nativeui + driving/review skills).
# They cross-reference each other ("see the nativeui-run skill"), so we install
# ALL of them — installing only one would leave those references dangling and
# lose capability.
#
# What it does (idempotent — re-running re-copies a fresh tree, so a second run
# is clean):
#   1. Resolves the shared plugin dir (../nativeui-plugin by default; override
#      with NATIVEUI_PLUGIN_DIR) and the Codex skills dir (~/.codex/skills by
#      default; override with CODEX_SKILLS_DIR; ~/.agents/skills also works).
#   2. Copies EVERY nativeui-plugin/skills/<name> -> <skills-dir>/<name>, and the
#      shared pure-Node toolchain nativeui-plugin/bin ONCE -> <skills-dir>/nativeui/bin
#      (BIN_ABS — bin travels with the primary skill; the rest point at it).
#   3. Rewrites the COPIES (never the originals): in each installed skill's
#      SKILL.md + every *.md it contains, replaces
#        ${CLAUDE_SKILL_DIR}/../../bin  -> BIN_ABS                       (FIRST)
#        ${CLAUDE_SKILL_DIR}            -> that skill's OWN install dir   (THEN)
#      so every `node ${CLAUDE_SKILL_DIR}/../../bin/<tool>.mjs` and every
#      references/examples path becomes an absolute path that works in Codex.
#   4. Prints the finish steps. NO config is required — the toolchain ships
#      baked-in PUBLIC dev defaults; the only setup step is browser SSO sign-in
#      (plus an active subscription). A blank ~/.nativeui/config.json is seeded
#      as a silent convenience for an optional environment override (only if
#      absent); it is NOT required and needs no edits for the default backend.
#
# Usage:
#   bash install.sh
#   CODEX_SKILLS_DIR=/path/to/skills bash install.sh   # install elsewhere
#   NATIVEUI_PLUGIN_DIR=/path/to/nativeui-plugin bash install.sh  # non-sibling layout
#
# The shared originals under nativeui-plugin/ are NEVER modified.

set -euo pipefail

# --- locate ourselves (works from any cwd) ---------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- resolve the shared NativeUI plugin dir --------------------------------
# Monorepo layout: nativeui-codex/ sits next to nativeui-plugin/, so the plugin
# is ../nativeui-plugin from here. A future standalone-mirror layout can point
# NATIVEUI_PLUGIN_DIR at the real plugin checkout.
PLUGIN_DIR="${NATIVEUI_PLUGIN_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)/nativeui-plugin}"
PLUGIN_SKILLS_SRC="$PLUGIN_DIR/skills"
PLUGIN_SKILL_SRC="$PLUGIN_SKILLS_SRC/nativeui"     # the primary skill (sanity check)
PLUGIN_BIN_SRC="$PLUGIN_DIR/bin"
# Blank override template — config is OPTIONAL (only to target a non-default
# environment); the baked-in PUBLIC dev defaults need no config at all.
OVERRIDE_TEMPLATE="$PLUGIN_BIN_SRC/config.example.json"

# --- resolve the Codex skills dir ------------------------------------------
# Default ~/.codex/skills (preferred). ~/.agents/skills is also a valid Codex
# skills location — set CODEX_SKILLS_DIR to use it (or any other path).
CODEX_SKILLS_DIR="${CODEX_SKILLS_DIR:-$HOME/.codex/skills}"
# The shared toolchain is copied ONCE here (travels with the primary skill); all
# skills' rewritten commands point at this single absolute BIN_ABS.
BIN_ABS="$CODEX_SKILLS_DIR/nativeui/bin"

NUI_CONFIG_DIR="$HOME/.nativeui"
NUI_CONFIG="$NUI_CONFIG_DIR/config.json"

# --- ANSI (skip if not a tty) ----------------------------------------------
if [ -t 1 ]; then B="\033[1m"; G="\033[32m"; Y="\033[33m"; R="\033[31m"; Z="\033[0m"; else B=""; G=""; Y=""; R=""; Z=""; fi
ok()   { printf "${G}ok${Z}   %s\n" "$1"; }
warn() { printf "${Y}warn${Z} %s\n" "$1"; }
err()  { printf "${R}err${Z}  %s\n" "$1" >&2; }
step() { printf "\n${B}%s${Z}\n" "$1"; }

printf "%bNativeUI for Codex — legacy skill installer%b\n" "$B" "$Z"
printf "package: %s\n" "$SCRIPT_DIR"

# --- preflight: node present (the toolchain is Node 18+) --------------------
if ! command -v node >/dev/null 2>&1; then
  err "node not found on PATH. NativeUI's toolchain needs Node 18+. Install it, then re-run."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 18 ] 2>/dev/null; then
  warn "node $(node --version 2>/dev/null) detected; NativeUI wants Node 18+. Continuing anyway."
fi

# --- sanity: the shared skill + toolchain exist ----------------------------
if [ ! -f "$PLUGIN_SKILL_SRC/SKILL.md" ]; then
  err "shared skill not found: $PLUGIN_SKILL_SRC/SKILL.md"
  err "  Expected nativeui-plugin/ next to nativeui-codex/ (monorepo layout)."
  err "  If it lives elsewhere, set NATIVEUI_PLUGIN_DIR to the nativeui-plugin checkout and re-run:"
  err "    NATIVEUI_PLUGIN_DIR=/path/to/nativeui-plugin bash install.sh"
  exit 1
fi
if [ ! -f "$PLUGIN_BIN_SRC/preflight.mjs" ]; then
  err "shared toolchain not found: $PLUGIN_BIN_SRC/preflight.mjs (NATIVEUI_PLUGIN_DIR=$PLUGIN_DIR)"
  exit 1
fi
ok "shared skill found:     $PLUGIN_SKILL_SRC"
ok "shared toolchain found: $PLUGIN_BIN_SRC"

# --- portable in-place sed (macOS BSD sed wants -i ''; GNU sed wants -i) ----
# Use a temp-file approach so we don't depend on which sed flavor is installed.
sed_replace_in_file() {
  # $1 = file, $2 = literal find string, $3 = literal replace string
  local file="$1" find="$2" repl="$3" tmp
  tmp="$(mktemp "${file}.XXXXXX")"
  # Escape the replacement for sed's RHS (& and \ and the delimiter |).
  local repl_esc
  repl_esc="$(printf '%s' "$repl" | sed -e 's/[\\&|]/\\&/g')"
  local find_esc
  find_esc="$(printf '%s' "$find" | sed -e 's/[][\\.^$*/|]/\\&/g')"
  sed "s|${find_esc}|${repl_esc}|g" "$file" > "$tmp"
  mv "$tmp" "$file"
}

# --- 1. Copy EVERY shared skill (fresh) into the Codex skills dir -----------
step "1) Install the skills -> $CODEX_SKILLS_DIR"
mkdir -p "$CODEX_SKILLS_DIR"
# Discover every skill folder (any dir under skills/ that has a SKILL.md).
SKILL_NAMES=()
for src in "$PLUGIN_SKILLS_SRC"/*/; do
  [ -f "$src/SKILL.md" ] || continue
  name="$(basename "$src")"
  dest="$CODEX_SKILLS_DIR/$name"
  rm -rf "$dest"               # idempotent: always start from a clean copy
  mkdir -p "$dest"
  cp -R "$src". "$dest"/       # SKILL.md + any references/ examples/ templates/
  SKILL_NAMES+=( "$name" )
  ok "installed skill: $name"
done
if [ "${#SKILL_NAMES[@]}" -eq 0 ]; then
  err "no skills found under $PLUGIN_SKILLS_SRC (expected SKILL.md in each subdir)."
  exit 1
fi
ok "installed ${#SKILL_NAMES[@]} skill(s): ${SKILL_NAMES[*]}"

# --- 2. Copy the shared toolchain ONCE (travels with the primary skill) -----
step "2) Install the toolchain -> $BIN_ABS"
rm -rf "$BIN_ABS"
mkdir -p "$BIN_ABS"
cp -R "$PLUGIN_BIN_SRC"/. "$BIN_ABS"/
ok "copied bin/ ($(find "$BIN_ABS" -name '*.mjs' | wc -l | tr -d ' ') scripts)"

# The bin is dependency-free pure Node (no package.json, no node_modules). If a
# future bin ships real npm deps (a package.json with a non-empty "dependencies"
# / "devDependencies"), install them in the COPIED bin dir only.
if [ -f "$BIN_ABS/package.json" ]; then
  if node -e 'const p=require(process.argv[1]); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; process.exit(Object.keys(d).length?0:1)' "$BIN_ABS/package.json" 2>/dev/null; then
    if command -v npm >/dev/null 2>&1; then
      ( cd "$BIN_ABS" && npm ci --omit=dev --no-audit --no-fund --loglevel=error ) >/dev/null 2>&1 \
        && ok "installed bin/ npm deps" \
        || warn "bin/ has npm deps but 'npm ci' failed — run it by hand in $BIN_ABS"
    else
      warn "bin/ has npm deps but npm is not on PATH — install them in $BIN_ABS"
    fi
  else
    ok "bin/ is dependency-free (no deps to install)"
  fi
else
  ok "bin/ is dependency-free (no package.json — pure Node)"
fi

# --- 3. Rewrite the COPIES: ${CLAUDE_SKILL_DIR} -> absolute Codex paths -----
# Codex does NOT set CLAUDE_SKILL_DIR, so the shared placeholders would break.
# Per skill: rewrite the more-specific .../../../bin pattern -> the single shared
# BIN_ABS FIRST, then the bare var -> that skill's OWN install dir (so each
# skill's references/examples/templates resolve relative to itself).
step "3) Rewrite \${CLAUDE_SKILL_DIR} placeholders -> absolute paths (copies only)"
rewritten=0
for name in "${SKILL_NAMES[@]}"; do
  skill_dir="$CODEX_SKILLS_DIR/$name"
  # Every .md in the installed skill (SKILL.md, references/*, templates/*, examples/*).
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    # ORDER MATTERS: the bin path is more specific, do it before the bare var.
    sed_replace_in_file "$f" '${CLAUDE_SKILL_DIR}/../../bin' "$BIN_ABS"
    sed_replace_in_file "$f" '${CLAUDE_SKILL_DIR}' "$skill_dir"
    rewritten=$((rewritten + 1))
  done < <(find "$skill_dir" -name '*.md')
done
ok "rewrote $rewritten markdown file(s) across ${#SKILL_NAMES[@]} skill(s)"

# Verify no placeholder survived in ANY installed skill.
survivors=""
for name in "${SKILL_NAMES[@]}"; do
  if grep -rl 'CLAUDE_SKILL_DIR' "$CODEX_SKILLS_DIR/$name" >/dev/null 2>&1; then
    survivors="$survivors $(grep -rln 'CLAUDE_SKILL_DIR' "$CODEX_SKILLS_DIR/$name")"
  fi
done
if [ -n "$survivors" ]; then
  err "a \${CLAUDE_SKILL_DIR} placeholder survived in the install:"
  printf '  %s\n' $survivors >&2
  exit 1
fi
ok "no \${CLAUDE_SKILL_DIR} placeholders remain in any installed skill"

# --- 4. NativeUI config: NONE required (NativeUI dev defaults are baked in) ---
# The toolchain works with zero config — the only setup is browser SSO sign-in.
# We drop a BLANK override template (only if absent) purely as a convenience for
# anyone who later wants to target a non-default environment; it needs no edits
# for the default dev backend, so there is no "set firebase.apiKey" step.
step "4) NativeUI config -> none required (optional override at $NUI_CONFIG)"
if [ -f "$NUI_CONFIG" ]; then
  ok "config exists already (left untouched)"
elif [ -f "$OVERRIDE_TEMPLATE" ]; then
  mkdir -p "$NUI_CONFIG_DIR"
  cp "$OVERRIDE_TEMPLATE" "$NUI_CONFIG"
  chmod 600 "$NUI_CONFIG" 2>/dev/null || true
  ok "no config needed (baked-in dev defaults); seeded a blank override template (optional)"
else
  ok "no config needed — the baked-in NativeUI dev defaults target https://dev.nativeui.com"
fi

# --- 5. Finish: how to use it ----------------------------------------------
step "5) Next steps"
cat <<EOF

Installed ${#SKILL_NAMES[@]} NativeUI skill(s) under:
  $CODEX_SKILLS_DIR
    ${SKILL_NAMES[*]}
with the shared toolchain at:
  $BIN_ABS

Finish setup — no configuration needed (NativeUI dev defaults are baked in):
  1. ${B}Sign in (SSO)${Z} — browser SSO is the only setup step (no password, no config):
       node "$BIN_ABS/login.mjs"
     It auto-opens the code-prefilled https://dev.nativeui.com/device?userCode=… page; approve there.
  2. ${B}Verify${Z} — must print "ok: <email>, subscription active" (an active subscription is required):
       node "$BIN_ABS/preflight.mjs"

  Optional: to target another environment (self-host / prod), override per-field via
  $NUI_CONFIG or NATIVEUI_* env vars (see $BIN_ABS/README.md). Defaults target https://dev.nativeui.com.

Use it in Codex:
  - Restart Codex (or open a new chat) so it discovers the new skills.
  - Run ${B}/skills${Z} and pick ${B}nativeui${Z} (the primary playbook), invoke ${B}\$nativeui${Z}, or
    just describe the app you want — Codex loads a skill implicitly. The driving
    skills (nativeui-app/-import/-export/-run/-connect/-backend/-test/-update) are
    installed too, so the playbook's cross-references resolve.

Preferred packaging path:
  The Codex plugin marketplace bundle is now primary. From the repo root:
       node nativeui-codex/build-codex-plugin.mjs
       codex plugin marketplace add ./
       codex plugin add nativeui@nativeui-marketplace

EOF

printf "%b%bDone.%b\n" "$G" "$B" "$Z"
