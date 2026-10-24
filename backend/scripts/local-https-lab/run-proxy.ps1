param([int]$HttpsPort = 5443, [int]$BackendPort = 5000)

$ErrorActionPreference = "Stop"
$certDirectory = Join-Path $env:LOCALAPPDATA "BankingSystem\local-https-lab"
$resolvedCertificate = (Resolve-Path -LiteralPath (Join-Path $certDirectory "local-https-server-cert.pem")).Path
$resolvedPrivateKey = (Resolve-Path -LiteralPath (Join-Path $certDirectory "local-https-server-key.pem")).Path
$oldCertificate = [Environment]::GetEnvironmentVariable("BANKING_LOCAL_HTTPS_CERT_PATH", "Process")
$oldPrivateKey = [Environment]::GetEnvironmentVariable("BANKING_LOCAL_HTTPS_KEY_PATH", "Process")
$oldHttpsPort = [Environment]::GetEnvironmentVariable("BANKING_LOCAL_HTTPS_PORT", "Process")
$oldBackendPort = [Environment]::GetEnvironmentVariable("BANKING_LOCAL_BACKEND_PORT", "Process")

try {
  $env:BANKING_LOCAL_HTTPS_CERT_PATH = $resolvedCertificate
  $env:BANKING_LOCAL_HTTPS_KEY_PATH = $resolvedPrivateKey
  $env:BANKING_LOCAL_HTTPS_PORT = [string]$HttpsPort
  $env:BANKING_LOCAL_BACKEND_PORT = [string]$BackendPort
  $scriptPath = Join-Path $PSScriptRoot "https-proxy.cjs"
  & node $scriptPath
  if ($LASTEXITCODE -ne 0) { throw "Local HTTPS proxy exited with code $LASTEXITCODE." }
}
finally {
  [Environment]::SetEnvironmentVariable("BANKING_LOCAL_HTTPS_CERT_PATH", $oldCertificate, "Process")
  [Environment]::SetEnvironmentVariable("BANKING_LOCAL_HTTPS_KEY_PATH", $oldPrivateKey, "Process")
  [Environment]::SetEnvironmentVariable("BANKING_LOCAL_HTTPS_PORT", $oldHttpsPort, "Process")
  [Environment]::SetEnvironmentVariable("BANKING_LOCAL_BACKEND_PORT", $oldBackendPort, "Process")
}
