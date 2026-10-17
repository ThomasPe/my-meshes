# Installs the freshly built MSIX, checks it is registered and launchable, then removes it.
$ErrorActionPreference = "Stop"
$spike = Split-Path -Parent $PSScriptRoot
$target = Join-Path $spike "src-tauri\target"
$msix = Get-Content (Join-Path $target "msix-path.txt")
Import-Certificate -FilePath (Join-Path $target "spike-dev.cer") -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
Add-AppxPackage -Path $msix
$pkg = Get-AppxPackage -Name "DevSym.MyMeshesSpike"
if (-not $pkg) { throw "package not registered after Add-AppxPackage" }
Write-Host "Installed $($pkg.PackageFullName) at $($pkg.InstallLocation)"
$exe = Join-Path $pkg.InstallLocation "my-meshes-spike.exe"
if (!(Test-Path $exe)) { throw "exe missing in package" }
# Launch via the package identity and give it a few seconds to come up.
$aumid = "$($pkg.PackageFamilyName)!MyMeshesSpike"
Start-Process "explorer.exe" "shell:AppsFolder\$aumid"
Start-Sleep -Seconds 8
$proc = Get-Process -Name "my-meshes-spike" -ErrorAction SilentlyContinue
if (-not $proc) { throw "packaged app did not start (no my-meshes-spike process)" }
Write-Host "Packaged app running: PID $($proc.Id)"
$proc | Stop-Process -Force
Remove-AppxPackage -Package $pkg.PackageFullName
Write-Host "Side-load round trip OK"
