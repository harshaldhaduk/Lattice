#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Lattice multi-user demo script
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
step() { echo -e "\n${BOLD}${BLUE}── $* ──${NC}"; }

# ── check server ─────────────────────────────────────────────────────────────
step "Checking server"
if ! curl -sf http://localhost:3001/health > /dev/null; then
  echo -e "${RED}Server not running. Start it with:  cd server && npm run dev${NC}"
  exit 1
fi
ok "Server is up"

# ── create or use session ─────────────────────────────────────────────────────
step "Session"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(curl -sf -X POST "$BASE/sessions" \
    -H "Content-Type: application/json" \
    -d '{"name":"Multi-user Demo"}' | jq -r '.id')
  ok "Created session: $SESSION_ID"
else
  ok "Using existing session: $SESSION_ID"
fi

# ── join participants ─────────────────────────────────────────────────────────
step "Participants joining"
ALICE_ID=$(curl -sf -X POST "$BASE/sessions/$SESSION_ID/join" \
  -H "Content-Type: application/json" \
  -d '{"participantName":"Alice","actorType":"human"}' | jq -r '.id')
ok "Alice (human) joined"

BOB_ID=$(curl -sf -X POST "$BASE/sessions/$SESSION_ID/join" \
  -H "Content-Type: application/json" \
  -d '{"participantName":"Bob (AI)","actorType":"agent"}' | jq -r '.id')
ok "Bob   (agent) joined"

# ── register intents on the same function ────────────────────────────────────
step "Registering intents"
curl -sf -X POST "$BASE/intents" -H "Content-Type: application/json" -d "{
  \"sessionId\":\"$SESSION_ID\",\"participantId\":\"$ALICE_ID\",
  \"description\":\"Add RS256 support to verifyToken\",
  \"filePaths\":[\"src/auth/middleware.ts\"],\"functionNames\":[\"verifyToken\"],
  \"priority\":\"blocking\"}" > /dev/null
ok "Alice claimed  src/auth/middleware.ts → verifyToken  [blocking]"

BOB_INTENT_ID=$(curl -sf -X POST "$BASE/intents" -H "Content-Type: application/json" -d "{
  \"sessionId\":\"$SESSION_ID\",\"participantId\":\"$BOB_ID\",
  \"description\":\"Refactor verifyToken to support multiple algorithms\",
  \"filePaths\":[\"src/auth/middleware.ts\"],\"functionNames\":[\"verifyToken\"],
  \"priority\":\"normal\"}" | jq -r '.id')
ok "Bob   claimed  src/auth/middleware.ts → verifyToken  [normal]"

# ── conflict check ────────────────────────────────────────────────────────────
step "Bob tries to save — conflict check"
VERDICT=$(curl -sf -X POST "$BASE/edits/check" -H "Content-Type: application/json" -d "{
  \"sessionId\":\"$SESSION_ID\",\"participantId\":\"$BOB_ID\",
  \"intentId\":\"$BOB_INTENT_ID\",\"filePath\":\"src/auth/middleware.ts\",
  \"diff\":\"+export function verifyToken(token: string, algo: 'HS256'|'RS256') {}\",
  \"functionNames\":[\"verifyToken\"]}")

VERDICT_TYPE=$(echo "$VERDICT" | jq -r '.verdict')
VERDICT_MSG=$(echo "$VERDICT"  | jq -r '.message')

echo ""
case "$VERDICT_TYPE" in
  SAFE)     echo -e "  ${GREEN}SAFE${NC}     $VERDICT_MSG" ;;
  REVIEW)   echo -e "  ${YELLOW}REVIEW${NC}   $VERDICT_MSG" ;;
  CONFLICT) echo -e "  ${RED}CONFLICT${NC} $VERDICT_MSG" ;;
esac

# ── poll for negotiation result ───────────────────────────────────────────────
if [ "$VERDICT_TYPE" = "CONFLICT" ]; then
  echo ""
  echo -e "  ${CYAN}Waiting for Claude to negotiate a resolution...${NC}"
  echo ""

  RESOLUTION=""
  for i in $(seq 1 12); do
    sleep 1
    printf "  ."
    STATE=$(curl -sf "$BASE/sessions/$SESSION_ID/state")
    RESOLUTION=$(echo "$STATE" | jq -r '
      .events[]
      | select(.eventType == "negotiation_resolved")
      | .message' | tail -1)
    if [ -n "$RESOLUTION" ]; then
      break
    fi
  done
  echo ""

  if [ -n "$RESOLUTION" ]; then
    # Extract type and reasoning from the message  e.g. "Resolution (SEQUENCE): Alice goes first..."
    RES_TYPE=$(echo "$RESOLUTION" | grep -oP '(?<=\().*(?=\))' || echo "RESOLVED")
    RES_REASON=$(echo "$RESOLUTION" | sed 's/Resolution ([^)]*): //')

    echo ""
    case "$RES_TYPE" in
      SEQUENCE) echo -e "  ${GREEN}► SEQUENCE${NC}  $RES_REASON" ;;
      PARALLEL) echo -e "  ${GREEN}► PARALLEL${NC}  $RES_REASON" ;;
      MERGE)    echo -e "  ${CYAN}► MERGE${NC}     $RES_REASON" ;;
      ESCALATE) echo -e "  ${YELLOW}► ESCALATE${NC}  $RES_REASON" ;;
      *)        echo -e "  ${GREEN}► $RES_TYPE${NC}  $RES_REASON" ;;
    esac
  else
    echo -e "  ${YELLOW}No negotiation result yet — check the Log tab in the extension.${NC}"
  fi
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
step "Summary"
STATE=$(curl -sf "$BASE/sessions/$SESSION_ID/state")
PARTICIPANT_COUNT=$(echo "$STATE" | jq '.participants | length')
INTENT_COUNT=$(echo "$STATE"     | jq '.intents | length')
EVENT_COUNT=$(echo "$STATE"      | jq '.events | length')
echo -e "  Participants : $PARTICIPANT_COUNT"
echo -e "  Intents      : $INTENT_COUNT"
echo -e "  Events       : $EVENT_COUNT"
echo ""
echo -e "  ${BOLD}Recent events:${NC}"
echo "$STATE" | jq -r '
  .events[-5:][]
  | "  \(.createdAt[11:19])  \(.actorName): \(.message)"'

echo ""
log "Session ID (join in extension): ${BOLD}$SESSION_ID${NC}"
echo ""
