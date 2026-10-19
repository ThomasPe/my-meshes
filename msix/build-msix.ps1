<#
.SYNOPSIS
  Packs the Store-flavored release build (no updater) into an MSIX. Tauri has no native MSIX
  output; this is the thin layer a Store pipeline needs on top of `tauri build`.

  Side-load (default): signs with a self-signed certificate whose subject equals the
  manifest Publisher. Store (-Store): leaves the package unsigned (the Store signs on
  submission) and stamps the Partner Center identity passed in.

.EXAMPLE
  npm run tauri:build:store
  ./msix/build-msix.ps1 -Version 0.1.0.0
  ./msix/build-msix.ps1 -Store -IdentityName "12345DevSym.Meshkeep" -Publisher "CN=0A1B2C3D-...." -Version 0.1.0.0
#>
param(
  [string]$Version = "",
  [string]$IdentityName = "DevSym.Meshkeep",
  [string]$Publisher = "CN=DevSym Dev",
  [string]$PublisherDisplayName = "DevSym",
  [switch]$Store,
  [string]$CertPassword = "meshkeep-dev"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repo "target"
$exe = Join-Path $target "release\meshkeep.exe"
if (!(Test-Path $exe)) { throw "Release binary not found: $exe. Run 'npm run tauri:build:store' first." }
if (-not $Version) {
  $pkg = Get-Content (Join-Path $repo "package.json") -Raw | ConvertFrom-Json
  $Version = "$($pkg.version).0"
}
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Version must have four parts (got '$Version')" }

function Find-SdkTool([string]$name) {
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  $tool = Get-ChildItem -Path $kits -Recurse -Filter $name -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\" } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $tool) { throw "$name not found under $kits (install the Windows 10/11 SDK)" }
  return $tool.FullName
}
$makeappx = Find-SdkTool "makeappx.exe"

# 1. Layout
$layout = Join-Path $target "msix-layout"
if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }
New-Item -ItemType Directory -Path $layout | Out-Null
Copy-Item $exe $layout
Copy-Item -Recurse (Join-Path $PSScriptRoot "Assets") (Join-Path $layout "Assets")
$manifest = Join-Path $layout "AppxManifest.xml"
$xml = Get-Content (Join-Path $PSScriptRoot "AppxManifest.xml") -Raw
$xml = $xml -replace 'Version="\d+\.\d+\.\d+\.\d+"', "Version=`"$Version`""
$xml = $xml -replace 'Identity Name="[^"]+"', "Identity Name=`"$IdentityName`""
$xml = $xml -replace 'Publisher="[^"]+"', "Publisher=`"$Publisher`""
$xml = $xml -replace '<PublisherDisplayName>[^<]*</PublisherDisplayName>', "<PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>"
Set-Content $manifest $xml -Encoding UTF8

# 2. Pack
$suffix = if ($Store) { "store" } else { "sideload" }
$msix = Join-Path $target "Meshkeep_${Version}_x64_$suffix.msix"
if (Test-Path $msix) { Remove-Item -Force $msix }
& $makeappx pack /d $layout /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed ($LASTEXITCODE)" }

if ($Store) {
  Write-Host "MSIX (unsigned, for Partner Center upload): $msix"
  "$msix" | Set-Content (Join-Path $target "msix-path.txt")
  exit 0
}

# 3. Self-signed cert whose subject equals the manifest Publisher (required for side-loading).
$signtool = Find-SdkTool "signtool.exe"
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $Publisher -and $_.NotAfter -gt (Get-Date) } | Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature -FriendlyName "Meshkeep (dev side-load)" `
    -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
}
$pfx = Join-Path $target "meshkeep-dev.pfx"
$cer = Join-Path $target "meshkeep-dev.cer"
$pwd = ConvertTo-SecureString -String $CertPassword -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pwd | Out-Null
Export-Certificate -Cert $cert -FilePath $cer | Out-Null

# 4. Sign
& $signtool sign /fd SHA256 /f $pfx /p $CertPassword $msix
if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }

Write-Host "MSIX : $msix"
Write-Host "Cert : $cer  (import into Trusted People before Add-AppxPackage on another machine)"
"$msix" | Set-Content (Join-Path $target "msix-path.txt")
