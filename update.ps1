# update.ps1 - Truck Gauge wireless update script
#
# USAGE:
#   .\update.ps1 firmware    - compile + flash firmware over WiFi (OTA)
#   .\update.ps1 dashboard   - build dashboard + upload all files to device
#   .\update.ps1 all         - do both
#
# REQUIREMENTS:
#   - Your PC must be connected to the "TruckGauge" WiFi AP
#   - Device reachable at http://buckifyoutruck.local (or 192.168.4.1)
#   - Arduino CLI installed (bundled with Arduino IDE)
#   - Node.js + npm installed (for dashboard builds)
#   - Python installed (for OTA flashing)
#
# OTA password: cummins

param(
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet("firmware","dashboard","all")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"

# --- Config ---
$DeviceHost     = "buckifyoutruck.local"
$DeviceIP       = "192.168.4.1"
$SketchPath     = "$PSScriptRoot\BuckIfYouTruck\BuckIfYouTruck.ino"
$BuildDir       = "$PSScriptRoot\build"
$DashboardSrc   = "C:\Users\johnd\Documents\Cummins_Gauge_Dashboard\gauge-dashboard-v1"
$DashboardDist  = "C:\Users\johnd\Documents\Cummins_Gauge_Dashboard\gauge-dashboard-v1\dist"
$ArduinoCLI     = "C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
$EspotaPy       = "C:\Users\johnd\AppData\Local\Arduino15\packages\arduino\hardware\esp32\2.0.18-arduino.5\tools\espota.py"
$FQBN           = "arduino:esp32:nano_nora"
$OtaPassword    = "cummins"

# --- Helpers ---
function Write-Step($msg) { Write-Host "" ; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "    FAIL: $msg" -ForegroundColor Red ; exit 1 }

function Check-DeviceReachable {
    Write-Step "Checking device..."
    try {
        $r = Invoke-WebRequest -Uri "http://$DeviceIP/api/sensors" -TimeoutSec 5 -UseBasicParsing
        Write-Ok "Device reachable at http://$DeviceHost"
    } catch {
        Write-Fail "Cannot reach device. Make sure you are connected to the TruckGauge WiFi AP."
    }
}

function Do-Firmware {
    Write-Step "Compiling firmware..."
    if (-not (Test-Path $BuildDir)) { New-Item -ItemType Directory -Path $BuildDir | Out-Null }
    & $ArduinoCLI compile --fqbn $FQBN --output-dir $BuildDir $SketchPath
    if ($LASTEXITCODE -ne 0) { Write-Fail "Compile failed" }
    Write-Ok "Compile successful"

    $binFile = "$BuildDir\BuckIfYouTruck.ino.bin"
    if (-not (Test-Path $binFile)) { Write-Fail "Binary not found at $binFile" }

    Write-Step "Uploading firmware via OTA to $DeviceIP..."
    python $EspotaPy -i $DeviceIP -p 3232 -a $OtaPassword -f $binFile
    if ($LASTEXITCODE -ne 0) { Write-Fail "OTA upload failed" }
    Write-Ok "Firmware uploaded - device is rebooting"
}

function Upload-File($localPath, $remotePath) {
    $fileName = [System.IO.Path]::GetFileName($localPath)
    Write-Host "    Uploading $fileName -> $remotePath"
    $url = "http://$DeviceIP/upload?path=$remotePath"
    # curl.exe is built into Windows 10/11 and handles multipart correctly
    $result = curl.exe -s -o NUL -w "%{http_code}" -X POST $url -F "file=@$localPath"
    if ($result -ne "200") { Write-Fail "Upload failed for $fileName (HTTP $result)" }
    Write-Ok $fileName
}

function Do-Dashboard {
    Write-Step "Building dashboard..."
    Push-Location $DashboardSrc
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { Write-Fail "npm run build failed" }
    } finally {
        Pop-Location
    }
    Write-Ok "Build complete"

    Write-Step "Uploading dashboard files to device..."

    Upload-File "$DashboardDist\index.html"   "/www/index.html"
    Upload-File "$DashboardDist\favicon.svg"  "/www/favicon.svg"
    Upload-File "$DashboardDist\icons.svg"    "/www/icons.svg"
    Upload-File "$DashboardDist\config\gauge_registry.json"           "/www/config/gauge_registry.json"
    Upload-File "$DashboardDist\config\theme_performance_chrome.json" "/www/config/theme_performance_chrome.json"
    Upload-File "$DashboardDist\config\example_dashboard.json"        "/www/config/example_dashboard.json"

    # Hashed JS asset
    $jsAsset = Get-ChildItem "$DashboardDist\assets\*.js" | Select-Object -First 1
    if (-not $jsAsset) { Write-Fail "No JS asset found in dist/assets/" }
    Upload-File $jsAsset.FullName "/www/assets/$($jsAsset.Name)"

    Write-Ok "Dashboard upload complete - refresh the browser to see changes"
}

# --- Main ---
Check-DeviceReachable

switch ($Mode) {
    "firmware"  { Do-Firmware }
    "dashboard" { Do-Dashboard }
    "all"       { Do-Firmware ; Start-Sleep 8 ; Check-DeviceReachable ; Do-Dashboard }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
