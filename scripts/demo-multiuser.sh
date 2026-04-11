#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Lattice multi-user demo script
#
# What this does:
#   1. Creates a fresh session (or joins an existing one with -s <id>)
#   2. Joins as "Alice" (human) — this is YOU in the extension
#   3. Joins as "Bob" (AI agent) — simulated by this script
#   4. Both register intents on the same file + function
#   5. Bob triggers a conflict check → Claude negotiates a resolution
#   6. Prints the full log of events
#
# Usage:
#   ./scripts/demo-multiuser.sh                  # creates a new session
#   ./scripts/demo-multiuser.sh -s <SESSION_ID>  # joins an existing session
#
# Prerequisites: server running on localhost:3001 and jq installed.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:3001/api"
SESSION_ID=""

while getopts "s:" opt; do
  case $opt in
    s) SESSION_ID="$OPTARG" ;;
    *) echo "Usage: $0 [-s session_id]" && exit 1 ;;
  esac
done

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[lattice]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
step() { echo -e "\n${BOLD}${BLUE}── $* ──${NC}"; }

# ── check server ─────────────────────────────────────────────────────────────
step "Checking server"
if ! curl -sf http://localhost:3001/health > /dev/null; then
  echo -e "${RED}Server not running. Start it with:${NC}"
  echo "  cd server && npm run dev"
  exit 1
fi
ok "Server is up"

# ── create or use session ─────────────────────────────────────────────────────
step "Session"
if [ -z "$SESSION_ID" ]; then
  SESSION=$(curl -sf -X POST "$BASE/sessions" \
    -H "Content-Type: application/json" \
    -d '{"name":"Multi-user Demo"}')
  SESSION_ID=$(echo "$SESSION" | jq -r '.id')
  ok "Created session: $SESSION_ID"
else
  ok "Using existing session: $SESSION_ID"
fi

# ── join as Alice (human) ─────────────────────────────────────────────────────
step "Alice joins (human)"
ALICE=$(curl -sf -X POST "$BASE/sessions/$SESSION_ID/join" \
  -H "Content-Type: application/json" \
  -d '{"participantName":"Alice","actorType":"human"}')
ALICE_ID=$(echo "$ALICE" | jq -r '.id')
ok "Alice joined — id: $ALICE_ID"

# ── join as Bob (AI agent) ────────────────────────────────────────────────────
step "Bob joins (AI agent)"
BOB=$(curl -sf -X POST "$BASE/sessions/$SESSION_ID/join" \
  -H "Content-Type: application/json" \
  -d '{"participantName":"Bob (AI)","actorType":"agent"}')
BOB_ID=$(echo "$BOB" | jq -r '.id')
ok "Bob joined   — id: $BOB_ID"

# ── Alice registers intent ────────────────────────────────────────────────────
step "Alice registers intent on auth/middleware.ts"
ALICE_INTENT=$(curl -sf -X POST "$BASE/intents" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\":      \"$SESSION_ID\",
    \"participantId\":  \"$ALICE_ID\",
    \"description\":    \"Add RS256 support to verifyToken\",
    \"filePaths\":      [\"src/auth/middleware.ts\"],
    \"functionNames\":  [\"verifyToken\"],
    \"priority\":       \"blocking\"
  }")
ALICE_INTENT_ID=$(echo "$ALICE_INTENT" | jq -r '.id')
ok "Alice intent: \"Add RS256 support to verifyToken\"  [blocking]"

# ── Bob registers a conflicting intent ───────────────────────────────────────
step "Bob registers a CONFLICTING intent on the same function"
BOB_INTENT=$(curl -sf -X POST "$BASE/intents" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\":      \"$SESSION_ID\",
    \"participantId\":  \"$BOB_ID\",
    \"description\":    \"Refactor verifyToken to support multiple algorithms\",
    \"filePaths\":      [\"src/auth/middleware.ts\"],
    \"functionNames\":  [\"verifyToken\"],
    \"priority\":       \"normal\"
  }")
BOB_INTENT_ID=$(echo "$BOB_INTENT" | jq -r '.id')
ok "Bob intent:   \"Refactor verifyToken to support multiple algorithms\"  [normal]"

# ── Bob checks his edit against Alice's active intent ─────────────────────────
step "Bob tries to save a change — conflict check fires"
VERDICT=$(curl -sf -X POST "$BASE/edits/check" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\":      \"$SESSION_ID\",
    \"participantId\":  \"$BOB_ID\",
    \"intentId\":       \"$BOB_INTENT_ID\",
    \"filePath\":       \"src/auth/middleware.ts\",
    \"diff\":           \"+export function verifyToken(token: string, algo = 'HS256' | 'RS256') {}\",
    \"functionNames\":  [\"verifyToken\"]
  }")

VERDICT_TYPE=$(echo "$VERDICT" | jq -r '.verdict')
VERDICT_MSG=$(echo "$VERDICT" | jq -r '.message')

echo ""
case "$VERDICT_TYPE" in
  SAFE)     echo -e "  Verdict: ${GREEN}SAFE${NC}    — $VERDICT_MSG" ;;
  REVIEW)   echo -e "  Verdict: ${YELLOW}REVIEW${NC}  — $VERDICT_MSG" ;;
  CONFLICT) echo -e "  Verdict: ${RED}CONFLICT${NC} — $VERDICT_MSG" ;;
  *)        echo -e "  Verdict: $VERDICT_TYPE — $VERDICT_MSG" ;;
esac

if [ "$VERDICT_TYPE" = "CONFLICT" ]; then
  warn "Conflict detected — Claude is negotiating a resolution (up to 8s)..."
fi

# ── wait a moment for async negotiation to complete ──────────────────────────
sleep 9

# ── print the event log ───────────────────────────────────────────────────────
step "Session event log"
STATE=$(curl -sf "$BASE/sessions/$SESSION_ID/state")
echo "$STATE" | jq -r '.events[] | "  \(.createdAt[11:19])  [\(.eventType)]  \(.actorName): \(.message)"'

# ── print current participants ────────────────────────────────────────────────
step "Participants"
echo "$STATE" | jq -r '.participants[] | "  \(.name)  [\(.actorType)]  \(.status)"'

echo ""
log "Session ID (paste into extension to join): ${BOLD}$SESSION_ID${NC}"
echo ""
