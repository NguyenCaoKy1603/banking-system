$ErrorActionPreference = "Stop"
$backendDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$names = @("BANKING_ENV", "NODE_ENV", "BANKING_STORAGE", "PORT", "BANKING_BIND_HOST", "ASSISTANT_ENABLED", "EMAIL_PROVIDER", "REGISTRATION_FINGERPRINT_KEY")
$previous = @{}
foreach ($name in $names) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}
$fingerprintKeyBytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($fingerprintKeyBytes)

$locationPushed = $false
try {
  $env:BANKING_ENV = "development"
  $env:NODE_ENV = "development"
  $env:BANKING_STORAGE = "in-memory"
  $env:PORT = "5000"
  $env:BANKING_BIND_HOST = "127.0.0.1"
  $env:ASSISTANT_ENABLED = "0"
  $env:EMAIL_PROVIDER = "disabled"
  $env:REGISTRATION_FINGERPRINT_KEY = "base64:$([Convert]::ToBase64String($fingerprintKeyBytes))"
  Push-Location $backendDirectory
  $locationPushed = $true
  Write-Output "Starting in-memory API on 127.0.0.1:5000. No database, worker, email provider, or AI provider is started."
  & npm.cmd run dev
  if ($LASTEXITCODE -ne 0) { throw "Local API exited with code $LASTEXITCODE." }
}
finally {
  if ($locationPushed) { Pop-Location }
  foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
  }
  [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($fingerprintKeyBytes)
}
