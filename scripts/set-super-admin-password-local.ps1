# TEMPORARY local password ceremony — Hyper Al-Moatasem System Owner.
# Run ONCE by the human in a REAL interactive PowerShell window at D:\Hyper_el-moatasem:
#   powershell -ExecutionPolicy Bypass -File .\scripts\set-super-admin-password-local.ps1
# This file contains NO secrets and must NEVER be committed. It is deleted after use.
# Flow: hidden entry + confirmation (SecureString, no echo) -> policy check ->
# Argon2id hash (existing project-configured mechanism) -> single-transaction
# password_hash-only update -> read-only verification -> in-memory auth test.
# Only non-secret PASS/FAIL lines are printed. Never run from a redirected/non-interactive shell.
$ErrorActionPreference = 'Stop'

try {
  node --version | Out-Null
}
catch {
  Write-Error 'LOCALPW_DENIED: node is not available in this terminal (database untouched)'
  exit 1
}

$sec1 = $null; $sec2 = $null
$plain = $null
try {
  # --- hidden entry + confirmation (policy: src/lib/auth/password.ts, 12..128, Argon2id) ---
  $sec1 = Read-Host -AsSecureString 'Enter new Super Admin password:'
  $sec2 = Read-Host -AsSecureString 'Confirm new Super Admin password:'
  $b1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec1)
  $b2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec2)
  try {
    $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b1)
    $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b2)
    $match = ($p1 -cne $null) -and ($p2 -cne $null) -and ($p1 -ceq $p2)
    $okLen = $match -and ($p1.Length -ge 12) -and ($p1.Length -le 128)
    if ($match) { $plain = $p1 }
    $p1 = $null; $p2 = $null
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2)
  }
  if (-not $match) { Write-Error 'LOCALPW_DENIED: password confirmation mismatch (database untouched)'; exit 1 }
  if (-not $okLen) { Write-Error 'LOCALPW_DENIED: password policy validation failed (database untouched)'; exit 1 }

  $worker = Join-Path $env:TEMP 'opencode\set-super-admin-pw-worker.cjs'
  if (-not (Test-Path -LiteralPath $worker)) { Write-Error 'LOCALPW_DENIED: worker file missing (database untouched)'; exit 1 }
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $plain | node $worker
  $code = $LASTEXITCODE
  if ($code -eq 0) { Write-Output 'LOCALPW_DONE: secret hygiene PASS (no secrets written, printed, or persisted by this script)' }
  exit $code
}
finally {
  if ($sec1) { $sec1.Dispose(); $sec1 = $null }
  if ($sec2) { $sec2.Dispose(); $sec2 = $null }
  if ($plain) { $plain = $null }
  [GC]::Collect()
}
