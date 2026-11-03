# Downloads the pinned SumatraPDF release, verifies its SHA-256, and places it where
# Tauri expects the sidecar: src-tauri/binaries/SumatraPDF-<target-triple>.exe
# To upgrade: change $Version and $Sha256 together (shasum -a 256 SumatraPDF-<v>-64.zip).
$ErrorActionPreference = "Stop"
$Version = "3.6.1"
$Sha256  = "98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544"
$Url     = "https://www.sumatrapdfreader.org/dl/rel/$Version/SumatraPDF-$Version-64.zip"

$Root = Split-Path -Parent $PSScriptRoot
$Bin  = Join-Path $Root "src-tauri/binaries"
$Dest = Join-Path $Bin "SumatraPDF-x86_64-pc-windows-msvc.exe"
if (Test-Path $Dest) { Write-Host "SumatraPDF already present"; exit 0 }

New-Item -ItemType Directory -Force -Path $Bin | Out-Null
$Zip = Join-Path ([System.IO.Path]::GetTempPath()) "sumatra-$Version.zip"
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
$Actual = (Get-FileHash -Algorithm SHA256 $Zip).Hash.ToLower()
if ($Actual -ne $Sha256) { throw "SumatraPDF checksum mismatch: expected $Sha256, got $Actual" }

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) "sumatra-$Version"
Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
Copy-Item (Join-Path $Tmp "SumatraPDF-$Version-64.exe") $Dest
Write-Host "SumatraPDF $Version -> $Dest"
