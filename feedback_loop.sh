#!/usr/bin/env bash
set -e

echo "=== [LOOP START] Checking Codebase Integrity ==="

# Step 1: Validate Backend Syntax
echo "--> Checking Node.js Server & Dependencies..."
node -c server/server.js || { echo "FATAL: Syntax error in server/server.js"; exit 1; }

# Step 2: Validate Frontend Build
echo "--> Building Frontend Project..."
(cd client && npm run build) || {
    echo "FATAL: Frontend build failed."
    exit 1
}

# Step 3: Enforce Guardrails (Rules Verification)
echo "--> Verifying rules.md compliance..."

# Check 1: Ensure phone/email/otp is never queried or stored in server.js
if grep -Ei "email|phone|otp" server/server.js | grep -v "phone numbers"; then
    echo "VIOLATION: Found phone/email reference in server/server.js"
    exit 1
fi

# Check 2: Ensure zero binary/blob storage inside SQL schema
if grep -Ei "bytea|blob" schema.sql; then
    echo "VIOLATION: Binary blobs found in PostgreSQL schema."
    exit 1
fi

# Step 4: Run Integration Tests
echo "--> Running Runtime Integration Tests..."
(cd server && node test_horizon_v2.js) || {
    echo "FATAL: Integration tests failed."
    exit 1
}

echo "=== [LOOP PASS] Code compiles and adheres to all directives. ==="
