# Installs the freshly built side-load MSIX, checks it is registered and launchable, then removes it.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repo "target"
$msix = Get-Content (Join-Path $target "msix-path.txt")
Import-Certificate -FilePath (Join-Path $target "meshkeep-dev.cer") -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
Add-AppxPackage -Path $msix
$pkg = Get-AppxPackage -Name "DevSym.Meshkeep"
if (-not $pkg) { throw "package not registered after Add-AppxPackage" }
Write-Host "Installed $($pkg.PackageFullName) at $($pkg.InstallLocation)"
if (!(Test-Path (Join-Path $pkg.InstallLocation "meshkeep.exe"))) { throw "exe missing in package" }
$aumid = "$($pkg.PackageFamilyName)!Meshkeep"
Start-Process "explorer.exe" "shell:AppsFolder\$aumid"
Start-Sleep -Seconds 10
$proc = Get-Process -Name "meshkeep" -ErrorAction SilentlyContinue
if (-not $proc) { throw "packaged app did not start (no meshkeep process)" }
Write-Host "Packaged app running: PID $($proc.Id)"
$proc | Stop-Process -Force
Remove-AppxPackage -Package $pkg.PackageFullName
Write-Host "Side-load round trip OK"
