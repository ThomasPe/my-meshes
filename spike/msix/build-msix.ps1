<#
.SYNOPSIS
  Packs the release build into an MSIX (Store-compatible layout) and signs it with a
  self-signed certificate for side-loading. Tauri has no native MSIX output; this is
  the small script a Store pipeline needs on top of `tauri build`.
.PARAMETER Profile   cargo profile folder (release)
.PARAMETER Version   four-part package version
#>
param(
  [string]$Profile = "release",
  [string]$Version = "0.1.0.0",
  [string]$CertPassword = "spike"
)
$ErrorActionPreference = "Stop"
$spike = Split-Path -Parent $PSScriptRoot
$target = Join-Path $spike "src-tauri\target"
$exe = Join-Path $target "$Profile\my-meshes-spike.exe"
if (!(Test-Path $exe)) { throw "Release binary not found: $exe. Run 'npm run tauri build -- --no-bundle' first." }

function Find-SdkTool([string]$name) {
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  $tool = Get-ChildItem -Path $kits -Recurse -Filter $name -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\" } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $tool) { throw "$name not found under $kits (install the Windows 10/11 SDK)" }
  return $tool.FullName
}
$makeappx = Find-SdkTool "makeappx.exe"
$signtool = Find-SdkTool "signtool.exe"

# 1. Layout
$layout = Join-Path $target "msix-layout"
if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }
New-Item -ItemType Directory -Path $layout | Out-Null
Copy-Item $exe $layout
Copy-Item (Join-Path $PSScriptRoot "AppxManifest.xml") $layout
Copy-Item -Recurse (Join-Path $PSScriptRoot "Assets") (Join-Path $layout "Assets")
# Stamp the version into the manifest.
$manifest = Join-Path $layout "AppxManifest.xml"
(Get-Content $manifest -Raw) -replace 'Version="\d+\.\d+\.\d+\.\d+"', "Version=`"$Version`"" | Set-Content $manifest -Encoding UTF8

# 2. Pack
$msix = Join-Path $target "MyMeshesSpike_${Version}_x64.msix"
if (Test-Path $msix) { Remove-Item -Force $msix }
& $makeappx pack /d $layout /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed ($LASTEXITCODE)" }

# 3. Self-signed cert whose subject equals the manifest Publisher (required for side-loading).
$subject = "CN=DevSym Spike"
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date) } | Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate -Type Custom -Subject $subject -KeyUsage DigitalSignature -FriendlyName "My Meshes Spike (dev)" `
    -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
}
$pfx = Join-Path $target "spike-dev.pfx"
$cer = Join-Path $target "spike-dev.cer"
$pwd = ConvertTo-SecureString -String $CertPassword -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pwd | Out-Null
Export-Certificate -Cert $cert -FilePath $cer | Out-Null

# 4. Sign
& $signtool sign /fd SHA256 /f $pfx /p $CertPassword $msix
if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }

Write-Host "MSIX : $msix"
Write-Host "Cert : $cer  (import into Trusted People before Add-AppxPackage on another machine)"
"$msix" | Set-Content (Join-Path $target "msix-path.txt")
