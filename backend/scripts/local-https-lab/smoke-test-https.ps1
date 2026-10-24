$ErrorActionPreference = "Stop"
$backendDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$nodePath = (Get-Command node.exe).Source
$certificateDirectory = Join-Path $env:LOCALAPPDATA "BankingSystem\local-https-lab"
$certificatePath = Join-Path $certificateDirectory "local-https-server-cert.pem"
$privateKeyPath = Join-Path $certificateDirectory "local-https-server-key.pem"
$caPath = Join-Path $certificateDirectory "local-https-ca.pem"
foreach ($file in @($certificatePath, $privateKeyPath, $caPath)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Local HTTPS lab certificate files are missing." }
}

$occupiedPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 5000, 5443 }
if ($occupiedPorts) { throw "Refusing to run the smoke test because port 5000 or 5443 is already in use." }

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("banking-local-https-smoke-" + [Guid]::NewGuid().ToString("N"))
$null = New-Item -ItemType Directory -Path $temporaryDirectory
$environmentNames = @(
  "BANKING_ENV", "NODE_ENV", "BANKING_STORAGE", "PORT", "BANKING_BIND_HOST", "ASSISTANT_ENABLED", "EMAIL_PROVIDER", "REGISTRATION_FINGERPRINT_KEY",
  "BANKING_LOCAL_HTTPS_CERT_PATH", "BANKING_LOCAL_HTTPS_KEY_PATH", "BANKING_LOCAL_HTTPS_PORT", "BANKING_LOCAL_BACKEND_PORT",
  "BANKING_LOCAL_HTTPS_CA_FILE"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
$backendProcess = $null
$proxyProcess = $null
$fingerprintKeyBytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($fingerprintKeyBytes)

try {
  $env:BANKING_ENV = "development"
  $env:NODE_ENV = "development"
  $env:BANKING_STORAGE = "in-memory"
  $env:PORT = "5000"
  $env:BANKING_BIND_HOST = "127.0.0.1"
  $env:ASSISTANT_ENABLED = "0"
  $env:EMAIL_PROVIDER = "disabled"
  $env:REGISTRATION_FINGERPRINT_KEY = "base64:$([Convert]::ToBase64String($fingerprintKeyBytes))"

  $backendProcess = Start-Process -FilePath $nodePath -ArgumentList @("--env-file-if-exists=.env", "--import=tsx", "src/server.ts") -WorkingDirectory $backendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryDirectory "backend.out") -RedirectStandardError (Join-Path $temporaryDirectory "backend.err")
  $backendReady = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    $backendListener = Get-NetTCPConnection -State Listen -LocalPort 5000 -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq "127.0.0.1"
    if ($backendListener) { $backendReady = $true; break }
    if ($backendProcess.HasExited) { break }
  }
  if (-not $backendReady) { throw "The in-memory API did not bind to local loopback." }

  $env:BANKING_LOCAL_HTTPS_CERT_PATH = $certificatePath
  $env:BANKING_LOCAL_HTTPS_KEY_PATH = $privateKeyPath
  $env:BANKING_LOCAL_HTTPS_PORT = "5443"
  $env:BANKING_LOCAL_BACKEND_PORT = "5000"
  $proxyProcess = Start-Process -FilePath $nodePath -ArgumentList @("scripts/local-https-lab/https-proxy.cjs") -WorkingDirectory $backendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryDirectory "proxy.out") -RedirectStandardError (Join-Path $temporaryDirectory "proxy.err")

  $proxyReady = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    $proxyListener = Get-NetTCPConnection -State Listen -LocalPort 5443 -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq "127.0.0.1"
    if ($proxyListener) { $proxyReady = $true; break }
    if ($proxyProcess.HasExited) { break }
  }
  if (-not $proxyReady) { throw "The local HTTPS proxy did not bind to local loopback." }

  $env:BANKING_LOCAL_HTTPS_CA_FILE = $caPath
  & $nodePath scripts/local-https-lab/probe-https.cjs
  if ($LASTEXITCODE -ne 0) { throw "The valid-CA HTTPS probe failed." }

  $env:BANKING_LOCAL_HTTPS_CA_FILE = $certificatePath
  & $nodePath scripts/local-https-lab/probe-https.cjs *> $null
  if ($LASTEXITCODE -eq 0) { throw "The invalid-CA HTTPS probe unexpectedly succeeded." }

  $listeners = Get-NetTCPConnection -State Listen -LocalPort 5000, 5443 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort
  if (@($listeners | Where-Object LocalAddress -ne "127.0.0.1").Count -gt 0) {
    throw "A local lab listener is not bound exclusively to loopback."
  }
  Write-Output "PASS: wrong-CA probe rejected; API and proxy listeners are loopback-only; no database or external provider was started."
}
finally {
  foreach ($process in @($proxyProcess, $backendProcess)) {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
  }
  [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($fingerprintKeyBytes)
  Start-Sleep -Milliseconds 300
  $resolvedTemporaryDirectory = [System.IO.Path]::GetFullPath($temporaryDirectory)
  $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if ($resolvedTemporaryDirectory.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTemporaryDirectory -Recurse -Force
  }
}
