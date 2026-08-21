#!/usr/bin/env bash
# AutomaQA prerequisite installer — macOS / Linux
# Installs only what is missing. Every action is printed before it runs.
set -uo pipefail

SCOPE="${1:-both}"
case "$SCOPE" in
  web|mobile|both) ;;
  *) echo "usage: $0 [web|mobile|both]" >&2; exit 2 ;;
esac

ok()   { printf '  [OK]   %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; }
step() { printf '\n==> %s\n' "$1"; }

FAILED=0

step "AutomaQA prerequisites (scope: $SCOPE)"
uname -s

if [ "$SCOPE" != "mobile" ]; then
  step "Node.js and npm"
  if command -v node >/dev/null 2>&1; then
    ok "node $(node -v)"
    ok "npm $(npm -v)"
  else
    warn "Node.js not found — install the LTS release from https://nodejs.org"
    FAILED=1
  fi

  if command -v npm >/dev/null 2>&1; then
    step "Playwright and browser drivers"
    npm install --no-fund --no-audit || { warn "npm install failed"; FAILED=1; }
    npx playwright install chromium || { warn "browser install failed"; FAILED=1; }
    if [ "$(uname -s)" = "Linux" ] && [ -n "${CI:-}" ]; then
      npx playwright install --with-deps || warn "system deps install failed"
    fi
    command -v npx >/dev/null 2>&1 && ok "playwright $(npx playwright --version 2>/dev/null || echo '?')"
  fi
fi

if [ "$SCOPE" != "web" ]; then
  step "Maestro CLI"
  if command -v maestro >/dev/null 2>&1; then
    ok "maestro $(maestro --version 2>/dev/null | head -1)"
  else
    echo "  installing from https://get.maestro.mobile.dev"
    curl -Ls "https://get.maestro.mobile.dev" | bash || { warn "Maestro install failed"; FAILED=1; }
    export PATH="$PATH:$HOME/.maestro/bin"
    if command -v maestro >/dev/null 2>&1; then
      ok "maestro installed"
      warn "add this to your shell profile: export PATH=\"\$PATH:\$HOME/.maestro/bin\""
    else
      warn "maestro still not on PATH"
      FAILED=1
    fi
  fi

  step "Java (required by Maestro)"
  if command -v java >/dev/null 2>&1; then
    ok "java present"
  else
    warn "Java 11+ not found — install Eclipse Temurin LTS from https://adoptium.net"
  fi

  step "Maestro MCP server"
  if command -v claude >/dev/null 2>&1; then
    if claude mcp list 2>/dev/null | grep -q maestro; then
      ok "maestro MCP already registered"
    else
      claude mcp add --scope user maestro maestro mcp \
        && { ok "registered"; warn "restart Claude Code — MCP servers load at startup"; } \
        || warn "registration failed; run: claude mcp add --scope user maestro maestro mcp"
    fi
  else
    warn "claude CLI not found — skipping MCP registration"
  fi
fi

step "Done"
if [ "$FAILED" -eq 0 ]; then
  echo "  Prerequisites satisfied. Next: run /automaqa:setup inside Claude Code."
  exit 0
else
  echo "  Some items need attention — see [WARN] lines above."
  exit 1
fi
