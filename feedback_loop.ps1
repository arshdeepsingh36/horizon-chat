# ==============================================================================
# Autonomous Vibe-Coding Feedback Loop Test Runner (PowerShell)
# Enforces: Syntax, Compilation, Guardrails, and End-to-End Integration
# ==============================================================================
$ErrorActionPreference = "Stop"

Write-Host "`n=== [LOOP START] Checking Horizon Chat Integrity ===" -ForegroundColor Cyan

# Step 1: Validate Backend Syntax & Modules
Write-Host "--> Step 1: Validating Node.js Server Syntax..." -ForegroundColor Yellow
$syntaxCheck = node -c server/server.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "FATAL: Syntax error in server/server.js" -ForegroundColor Red
    exit 1
}
Write-Host "[PASS] Backend server syntax check passed." -ForegroundColor Green

# Step 2: Validate Frontend Web Application Build
Write-Host "--> Step 2: Validating Frontend Vite Build..." -ForegroundColor Yellow
Push-Location client
npm run build --silent
if ($LASTEXITCODE -ne 0) {
    Write-Host "FATAL: Frontend build failed. Fix compilation/lint errors." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "[PASS] Frontend React + Vite production build passed." -ForegroundColor Green

# Step 3: Enforce Guardrails (Rules Verification)
Write-Host "--> Step 3: Enforcing rules.md Guardrails..." -ForegroundColor Yellow

# Check 3.1: Minimal Identity Surface - Ensure email/phone/otp are NEVER queried or stored in server.js
$identityLeaks = Select-String -Path "server/server.js" -Pattern "email|phone|otp" -CaseSensitive:$false
if ($identityLeaks) {
    $actualLeaks = $identityLeaks | Where-Object { $_.Line -notmatch "phone numbers" }
    if ($actualLeaks) {
        Write-Host "VIOLATION: Found phone/email/otp reference in server/server.js" -ForegroundColor Red
        exit 1
    }
}
Write-Host "[PASS] Guardrail: Zero phone/email identity leaks." -ForegroundColor Green

# Check 3.2: Zero Database Blob Storage - Ensure zero binary blobs in SQL schema
$blobLeaks = Select-String -Path "schema.sql" -Pattern "bytea|blob" -CaseSensitive:$false
if ($blobLeaks) {
    Write-Host "VIOLATION: Binary blobs found in PostgreSQL schema.sql" -ForegroundColor Red
    exit 1
}
Write-Host "[PASS] Guardrail: Zero raw binary blob storage in relational database." -ForegroundColor Green

# Check 3.3: Theme Token Verification
$cssTokens = Get-Content "client/src/index.css" -Raw
if ($cssTokens -notmatch "#0E1626" -or $cssTokens -notmatch "#EA580C" -or $cssTokens -notmatch "#F59E0B") {
    Write-Host "VIOLATION: Sunset Glow and Twilight Ocean palette tokens missing in index.css" -ForegroundColor Red
    exit 1
}
Write-Host "[PASS] Guardrail: Sunset Glow and Twilight Ocean palette verified." -ForegroundColor Green

# Step 4: Run Runtime Integration Test Suite
Write-Host "--> Step 4: Executing Integration Test Suite (test_horizon_v2.js)..." -ForegroundColor Yellow
Push-Location server
node test_horizon_v2.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "FATAL: Integration tests failed." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "[PASS] All integration test assertions passed (100%)." -ForegroundColor Green

Write-Host "`n=== [LOOP PASS] Code compiles and adheres to all directives. ===`n" -ForegroundColor Green
exit 0
