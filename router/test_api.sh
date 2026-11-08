#!/bin/sh
# ==============================================================================
# ArcherGuard C6 — Phase 1 Verification Test Suite (router/test_api.sh)
# Max lines: < 250 (DRY Principle Enforced)
# ==============================================================================

SCRIPT_DIR="$(dirname "$0")"
HELPER="$SCRIPT_DIR/archer_c6_helper.sh"
chmod +x "$HELPER" "$SCRIPT_DIR"/lib/*.sh 2>/dev/null

TESTS_PASSED=0
TESTS_FAILED=0

assert_test() {
    _name="$1"; _result="$2"
    if [ "$_result" -eq 0 ]; then
        printf "  ✅ [PASS] %s\n" "$_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        printf "  ❌ [FAIL] %s\n" "$_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

printf "\n🧪 Starting ArcherGuard C6 Phase 1 Test Suite...\n\n"

# 1. Line count check (Strict <= 250 lines rule)
printf "1. Checking Line Count Mandate (<= 250 lines per file):\n"
_line_failures=0
for _f in "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/lib/*.sh; do
    [ ! -f "$_f" ] && continue
    _lines=$(wc -l < "$_f" | tr -d ' ')
    if [ "$_lines" -gt 250 ]; then
        printf "     ⚠️ Line limit exceeded in %s: %s lines\n" "$_f" "$_lines"
        _line_failures=$((_line_failures + 1))
    fi
done
assert_test "All router files adhere to <= 250 lines rule" "$_line_failures"

# 2. Syntax check
printf "\n2. Shell Syntax Verification (sh -n):\n"
_syntax_err=0
for _f in "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/lib/*.sh; do
    [ ! -f "$_f" ] && continue
    sh -n "$_f" 2>/dev/null || _syntax_err=$((_syntax_err + 1))
done
assert_test "Zero syntax errors across all POSIX scripts" "$_syntax_err"

# 3. Test 'status' action JSON output
printf "\n3. Testing 'status' action:\n"
OUTPUT=$(REQUEST_METHOD="GET" QUERY_STRING="action=status" "$HELPER" 2>/dev/null)
printf "%s" "$OUTPUT" | grep -q '"cpu":'
R1=$?
printf "%s" "$OUTPUT" | grep -q '"memory":'
R2=$?
printf "%s" "$OUTPUT" | grep -q '"ports":'
R3=$?
printf "%s" "$OUTPUT" | grep -q '"wireless":'
R4=$?
assert_test "Status returns valid telemetry JSON schema" "$((R1 + R2 + R3 + R4))"

# 4. Test 'speed' action JSON output
printf "\n4. Testing 'speed' action:\n"
SPEED_OUT=$(REQUEST_METHOD="GET" QUERY_STRING="action=speed" "$HELPER" 2>/dev/null)
printf "%s" "$SPEED_OUT" | grep -q '"traffic":'
assert_test "Speed action returns traffic metrics" "$?"

# 5. Test 'clients' action JSON output
printf "\n5. Testing 'clients' action:\n"
# 5. Test 'clients' action JSON output (authenticated)
printf "\n5. Testing 'clients' action:\n"
mkdir -p /tmp/archer_sessions
touch /tmp/archer_sessions/test_session_token_123
CLIENT_OUT=$(REQUEST_METHOD="GET" QUERY_STRING="action=clients&token=test_session_token_123" "$HELPER" 2>/dev/null)
printf "%s" "$CLIENT_OUT" | grep -q '"clients":\['
assert_test "Clients action returns clients list" "$?"

# 6. Test Authentication on mutating action (unauthorized check)
printf "\n6. Testing Security & Authentication Check:\n"
AUTH_FAIL=$(REQUEST_METHOD="GET" QUERY_STRING="action=control&cmd=reboot" "$HELPER" 2>/dev/null)
printf "%s" "$AUTH_FAIL" | grep -q '"error":"unauthorized"'
assert_test "Mutating action rejects unauthenticated session" "$?"

# 7. Test Authorized action execution (drop_caches dry-run)
printf "\n7. Testing Authorized Mutating Action:\n"
AUTH_PASS=$(REQUEST_METHOD="GET" QUERY_STRING="action=control&cmd=drop_caches&token=test_session_token_123" "$HELPER" 2>/dev/null)
printf "%s" "$AUTH_PASS" | grep -q '"status":"success"'
assert_test "Authorized action succeeds with valid session token" "$?"

# 8. Test 'analytics' action JSON output
printf "\n8. Testing 'analytics' action:\n"
ANALYTICS_OUT=$(REQUEST_METHOD="GET" QUERY_STRING="action=analytics&token=test_session_token_123" "$HELPER" 2>/dev/null)
printf "%s" "$ANALYTICS_OUT" | grep -q '"analytics":'
assert_test "Analytics action returns bandwidth quota metrics" "$?"

# 9. Test 'cron' action JSON output
printf "\n9. Testing 'cron' action:\n"
CRON_OUT=$(REQUEST_METHOD="GET" QUERY_STRING="action=cron&token=test_session_token_123" "$HELPER" 2>/dev/null)
printf "%s" "$CRON_OUT" | grep -q '"crontab":'
assert_test "Cron action returns crontab automation metrics" "$?"

# 10. Test Authorized Cron Toggle Action
printf "\n10. Testing Authorized Cron Toggle Action:\n"
CRON_TOGGLE=$(REQUEST_METHOD="GET" QUERY_STRING="action=control&cmd=toggle_cron_task&target=midnight_reboot&val=1&token=test_session_token_123" "$HELPER" 2>/dev/null)
printf "%s" "$CRON_TOGGLE" | grep -q '"status":"success"'
assert_test "Authorized cron toggle succeeds with valid session token" "$?"

rm -f /tmp/archer_sessions/test_session_token_123

printf "\n=======================================================\n"
printf "Results: %d Passed, %d Failed\n" "$TESTS_PASSED" "$TESTS_FAILED"
printf "=======================================================\n\n"

[ "$TESTS_FAILED" -eq 0 ] && exit 0 || exit 1
