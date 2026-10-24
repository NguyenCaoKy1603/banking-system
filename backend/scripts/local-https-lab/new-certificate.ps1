param(
  [string]$OutputDirectory = (Join-Path $env:LOCALAPPDATA "BankingSystem\local-https-lab")
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "Use PowerShell 7 or newer to create the local HTTPS lab certificate."
}

$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$localAppData = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $outputPath.StartsWith($localAppData, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Certificate and private-key files must stay under LOCALAPPDATA, outside the repository."
}
if (Test-Path -LiteralPath $outputPath) {
  throw "Refusing to overwrite an existing local HTTPS certificate directory. Remove it manually only after confirming it belongs to this lab."
}

$null = New-Item -ItemType Directory -Path $outputPath
$caRsa = [System.Security.Cryptography.RSA]::Create(2048)
$leafRsa = [System.Security.Cryptography.RSA]::Create(2048)
$caCertificate = $null
$leafCertificate = $null

try {
  $now = [DateTimeOffset]::UtcNow
  $caRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=Banking Local HTTPS Lab CA",
    $caRsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $caRequest.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $true, 1, $true)
  )
  $caUsage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature
  $caRequest.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($caUsage, $true)
  )
  $caRequest.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($caRequest.PublicKey, $false)
  )
  $caCertificate = $caRequest.CreateSelfSigned($now.AddMinutes(-5), $now.AddDays(365))

  $leafRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=localhost",
    $leafRsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $leafRequest.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true)
  )
  $leafUsage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment
  $leafRequest.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($leafUsage, $true)
  )
  $ekuOids = [System.Security.Cryptography.OidCollection]::new()
  $null = $ekuOids.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.1"))
  $leafRequest.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($ekuOids, $false)
  )
  $sanBuilder = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $sanBuilder.AddDnsName("localhost")
  $sanBuilder.AddIpAddress([System.Net.IPAddress]::Parse("127.0.0.1"))
  $sanBuilder.AddIpAddress([System.Net.IPAddress]::Parse("10.0.2.2"))
  $leafRequest.CertificateExtensions.Add($sanBuilder.Build())
  $leafRequest.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($leafRequest.PublicKey, $false)
  )
  $serial = [byte[]]::new(16)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($serial)
  $issuedLeaf = $leafRequest.Create($caCertificate, $now.AddMinutes(-5), $now.AddDays(30), $serial)
  $leafCertificate = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($issuedLeaf, $leafRsa)

  [System.IO.File]::WriteAllText((Join-Path $outputPath "local-https-ca.pem"), $caCertificate.ExportCertificatePem(), [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllBytes((Join-Path $outputPath "local-https-ca.cer"), $caCertificate.RawData)
  [System.IO.File]::WriteAllText((Join-Path $outputPath "local-https-server-cert.pem"), $leafCertificate.ExportCertificatePem(), [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $outputPath "local-https-server-key.pem"), $leafRsa.ExportPkcs8PrivateKeyPem(), [System.Text.UTF8Encoding]::new($false))

  [pscustomobject]@{
    Result = "CERTIFICATES_CREATED"
    Directory = $outputPath
    Hostnames = "localhost, 127.0.0.1, 10.0.2.2"
    LeafThumbprint = $leafCertificate.Thumbprint
    CaThumbprint = $caCertificate.Thumbprint
    LeafExpiresUtc = $leafCertificate.NotAfter.ToUniversalTime().ToString("o")
    PrivateKeyFilesStayOutsideRepository = $true
    TrustStoreModified = $false
  } | ConvertTo-Json -Compress | Write-Output
}
catch {
  if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Recurse -Force
  }
  throw
}
finally {
  if ($caCertificate) { $caCertificate.Dispose() }
  if ($leafCertificate) { $leafCertificate.Dispose() }
  $caRsa.Dispose()
  $leafRsa.Dispose()
}
