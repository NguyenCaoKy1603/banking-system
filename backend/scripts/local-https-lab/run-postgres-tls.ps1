param([switch]$PullImage)

$ErrorActionPreference = "Stop"
$image = "postgres:16@sha256:c1b3783309b6499c795eed7c20135a1a4d25cae1b575c3d52c6f536129a1b109"
$certDirectory = (Join-Path $env:LOCALAPPDATA "BankingSystem\local-https-lab")
$caFile = Join-Path $certDirectory "local-https-ca.pem"
$certificateFile = Join-Path $certDirectory "local-https-server-cert.pem"
$keyFile = Join-Path $certDirectory "local-https-server-key.pem"
foreach ($file in @($caFile, $certificateFile, $keyFile)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required local TLS certificate file is missing." }
}

& docker image inspect $image *> $null
if ($LASTEXITCODE -ne 0) {
  if (-not $PullImage) {
    throw "The pinned PostgreSQL image is not cached. This script will not download it automatically; rerun with -PullImage only if you accept the network data transfer (the image itself is public and has no service fee)."
  }
  & docker pull $image
  if ($LASTEXITCODE -ne 0) { throw "Could not download the pinned public PostgreSQL image." }
}

$containerName = "banking-local-tls-lab-$([Guid]::NewGuid().ToString('N').Substring(0, 10))"
$dbPasswordBytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($dbPasswordBytes)
$dbPassword = [Convert]::ToBase64String($dbPasswordBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
$databaseUrl = "postgresql://lab:$dbPassword@127.0.0.1:55433/banking_tls_lab"
$envNames = @("BANKING_ENV", "DATABASE_URL", "DATABASE_SERVER_NAME", "BANKING_LOCAL_HTTPS_CA_FILE")
$previous = @{}
foreach ($name in $envNames) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
$containerStarted = $false

try {
  $env:BANKING_ENV = "development"
  $env:DATABASE_URL = $databaseUrl
  $env:DATABASE_SERVER_NAME = "localhost"
  $env:BANKING_LOCAL_HTTPS_CA_FILE = $caFile

  $dockerCommand = @(
    "run", "--detach", "--rm", "--name", $containerName,
    "--publish", "127.0.0.1:55433:5432",
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,size=128m,uid=0,gid=0,mode=0700",
    "--env", "POSTGRES_USER=lab",
    "--env", "POSTGRES_PASSWORD=$dbPassword",
    "--env", "POSTGRES_DB=banking_tls_lab",
    "--user", "0", "--entrypoint", "bash", $image,
    "-c",
    'while [ ! -f /tmp/start-postgres ]; do sleep 0.1; done; if cp /tmp/local-https-server-cert.pem /tmp/local-server.crt && cp /tmp/local-https-server-key.pem /tmp/local-server.key && chown postgres:postgres /tmp/local-server.crt /tmp/local-server.key && chmod 600 /tmp/local-server.key && /usr/local/bin/docker-entrypoint.sh postgres -c ssl=on -c ssl_min_protocol_version=TLSv1.2 -c ssl_cert_file=/tmp/local-server.crt -c ssl_key_file=/tmp/local-server.key; then :; else status=$?; echo "PostgreSQL startup failed; retaining redacted-by-design container logs until the host cleanup runs."; sleep 60; exit $status; fi'
  )
  & docker @dockerCommand *> $null
  if ($LASTEXITCODE -ne 0) { throw "Could not start the local disposable PostgreSQL TLS container." }
  $containerStarted = $true

  & docker cp $certificateFile "${containerName}:/tmp/local-https-server-cert.pem" *> $null
  if ($LASTEXITCODE -ne 0) { throw "Could not copy the local TLS certificate into the disposable container." }
  & docker cp $keyFile "${containerName}:/tmp/local-https-server-key.pem" *> $null
  if ($LASTEXITCODE -ne 0) { throw "Could not copy the local TLS private key into the disposable container." }
  & docker exec $containerName touch /tmp/start-postgres *> $null
  if ($LASTEXITCODE -ne 0) { throw "Could not start PostgreSQL inside the disposable container." }

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    & docker exec $containerName pg_isready -U lab -d banking_tls_lab *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    $startupLogs = & docker logs --tail 40 $containerName 2>&1
    foreach ($line in $startupLogs) {
      $safeLine = ([string]$line).Replace($dbPassword, "<redacted>").Replace($databaseUrl, "<redacted>")
      Write-Output "[postgres-startup] $safeLine"
    }
    throw "The local PostgreSQL TLS container did not become ready. Startup output above is redacted."
  }

  Push-Location (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  try {
    & node --import=tsx scripts/local-https-lab/probe-postgres-tls.ts
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL TLS verification failed." }
  }
  finally { Pop-Location }
}
finally {
  if ($containerStarted) {
    & docker rm --force $containerName *> $null
  }
  foreach ($name in $envNames) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
  }
  [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($dbPasswordBytes)
  $dbPassword = $null
  $databaseUrl = $null
}

Write-Output "Disposable TLS database removed; no volume or database persists."
