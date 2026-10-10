$ErrorActionPreference = "Stop"

$bundleDirectory = if ($env:EDUPI_PREVIEW_INSTALLER_DIR) { $env:EDUPI_PREVIEW_INSTALLER_DIR } else { "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis" }
$installers = @(Get-ChildItem $bundleDirectory -Filter "*-setup.exe" -File)
if ($installers.Count -ne 1) { throw "Expected exactly one Windows preview installer" }

$testRoot = Join-Path $env:USERPROFILE "edupi-route1-preview-$([guid]::NewGuid().ToString('N'))"
$destination = Join-Path $testRoot "application"
$dataRoot = Join-Path $testRoot "teacher-data"
$agentDir = Join-Path $testRoot "agent"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& (Join-Path $env:SystemRoot "System32/icacls.exe") $testRoot "/inheritance:r" "/grant:r" "*${sid}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Isolated preview installation root ACL setup failed" }
New-Item -ItemType Directory -Force -Path $destination, $dataRoot, $agentDir | Out-Null
$env:EDUPI_PROJECT_ROOT = $dataRoot
$env:EDUPI_DATA_ROOT = $dataRoot
$env:EDUPI_DATA_ALLOWED_ROOT = $testRoot
$env:PI_CODING_AGENT_DIR = $agentDir
$env:PI_OFFLINE = "1"

$executable = Join-Path $destination "pi-agent-desktop.exe"
function Stop-InstalledPreviewProcesses {
    $targets = @(Get-Process -Name "pi-agent-desktop" -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $executable })
    foreach ($target in $targets) {
        # The installed shell owns a local server child. Stop the exact test
        # instance and its children together before starting the Safe Mode run.
        & (Join-Path $env:SystemRoot "System32/taskkill.exe") /PID $target.Id /T /F | Out-Null
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $remaining = @(Get-Process -Name "pi-agent-desktop" -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq $executable })
        if ($remaining.Count -eq 0) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Installed preview process did not stop: $($remaining.Id -join ',')"
}
try {
$installation = Start-Process -FilePath $installers[0].FullName -ArgumentList "/S", "/D=$destination" -Wait -PassThru
if ($installation.ExitCode -ne 0) { throw "Preview installer returned a nonzero exit code" }
$resources = Join-Path $destination "resources"
$bundledNode = Join-Path $resources "node/node.exe"
$coreRoot = Join-Path $resources "edupi-core"
foreach ($required in @($executable, $bundledNode, (Join-Path $coreRoot "scripts/core_runtime_root.mjs"))) {
    if (!(Test-Path $required)) { throw "Installed preview resource missing: $([System.IO.Path]::GetFileName($required))" }
}
$compat = Get-Content "contracts/edupi-core-compat.json" -Raw | ConvertFrom-Json
$desktopManifest = Get-Content (Join-Path $coreRoot "contracts/edupi-desktop-component-manifest.json") -Raw | ConvertFrom-Json
$runtimeManifest = Get-Content (Join-Path $coreRoot "contracts/edupi-core-runtime-component-manifest.json") -Raw | ConvertFrom-Json
if ($desktopManifest.component_manifest_hash -ne $compat.core_runtime.component_manifest_hash -or
    $runtimeManifest.component_manifest_hash -ne $compat.core_runtime.runtime_component_manifest_hash) {
    throw "Installed Core component manifests differ from the Desktop compatibility pin"
}
$nativeContract = Get-Content (Join-Path $coreRoot "contracts/windows-runtime-attestation-v1.json") -Raw | ConvertFrom-Json
if ($nativeContract.status -ne "approved") { throw "Installed Core native contract is not approved" }
$nativeAsset = Join-Path $coreRoot $nativeContract.binary_relative_path
if (!(Test-Path $nativeAsset -PathType Leaf)) { throw "Approved native asset is missing from the installed preview" }
if ((Get-Item $nativeAsset).Length -ne $nativeContract.binary_size) { throw "Installed native asset size differs from Core approval" }
$nativeDigest = "sha256:$((Get-FileHash $nativeAsset -Algorithm SHA256).Hash.ToLowerInvariant())"
if ($nativeDigest -ne $nativeContract.binary_sha256) { throw "Installed native asset SHA-256 differs from Core approval" }

# Normal mode must still refuse native Core root admission. This does not
# substitute for the separately guarded Safe Mode isolated canary below.
$env:EDUPI_INSTALLED_CORE_ROOT = $coreRoot
$rootProbe = @'
import path from "node:path";
import { pathToFileURL } from "node:url";
const core = await import(pathToFileURL(path.join(process.env.EDUPI_INSTALLED_CORE_ROOT, "scripts/core_runtime_root.mjs")).href);
const result = core.prepareCoreRuntimeRoot(process.env.EDUPI_DATA_ROOT);
if (result.ok || result.code !== "native_attestation_required") process.exit(1);
console.log(JSON.stringify({ coreRoot: "native_attestation_required", g1Installed: false }));
'@
& $bundledNode --input-type=module -e $rootProbe
if ($LASTEXITCODE -ne 0) { throw "Installed Core did not fail closed at the documented Windows attestation boundary" }

$running = @(Get-Process -Name "pi-agent-desktop" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $executable })
if ($running.Count -gt 1) { throw "Installer started multiple preview application processes" }
$application = $running | Select-Object -First 1
if (!$application) { $application = Start-Process -FilePath $executable -PassThru }
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $application.Refresh()
        if ($application.HasExited) { throw "Installed preview application exited before its local server was ready" }
        $logRoots = @((Join-Path $env:LOCALAPPDATA "com.abcwyc.pi-agent"), (Join-Path $env:APPDATA "com.abcwyc.pi-agent"))
        $logs = @($logRoots | Where-Object { Test-Path $_ } |
            ForEach-Object { Get-ChildItem $_ -Filter "server.log" -Recurse -ErrorAction SilentlyContinue })
        foreach ($log in $logs) {
            $ports = [regex]::Matches((Get-Content $log.FullName -Raw), 'http://127\.0\.0\.1:(\d+)')
            if ($ports.Count -eq 0) { continue }
            $origin = "http://127.0.0.1:$($ports[$ports.Count - 1].Groups[1].Value)"
            try {
                $response = Invoke-WebRequest "$origin/api/home" -Headers @{ Origin = $origin } -TimeoutSec 3
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            } catch { }
        }
        if ($ready) { break }
        Start-Sleep -Seconds 2
    }
    if (!$ready) { throw "Installed preview local server did not become ready" }
    $second = Start-Process -FilePath $executable -PassThru
    try {
        Wait-Process -Id $second.Id -Timeout 10 -ErrorAction SilentlyContinue
        $second.Refresh()
        if (!$second.HasExited) { throw "Second launch did not hand off to the installed process" }
        $remaining = @(Get-Process -Name "pi-agent-desktop" -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq $executable })
        if ($remaining.Count -ne 1) { throw "Installed preview has more than one active application process" }
    } finally {
        $second.Refresh()
        if (!$second.HasExited) { Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue }
    }
    Write-Output "Windows preview installer retained the approved native bytes, started with isolated data, and kept normal-mode G1 blocked."
} finally {
    Stop-InstalledPreviewProcesses
}

# Exercise the installed executable's native root and private-state guards,
# without enabling G1 or touching any teacher's configured data directory.
$canaryRoot = Join-Path $env:USERPROFILE "edupi-route1-canary-preview-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $canaryRoot | Out-Null
& (Join-Path $env:SystemRoot "System32/icacls.exe") $canaryRoot "/inheritance:r" "/grant:r" "*${sid}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Isolated canary root ACL setup failed" }
foreach ($relative in @(".edupi/memory", ".edupi/output", ".edupi/locks")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $canaryRoot $relative) | Out-Null
}
$env:EDUPI_PROJECT_ROOT = $canaryRoot
$env:EDUPI_DATA_ROOT = $canaryRoot
$env:EDUPI_DATA_ALLOWED_ROOT = $env:USERPROFILE
$env:EDUPI_ROUTE1_ISOLATED_CANARY = "1"
$logRoots = @((Join-Path $env:LOCALAPPDATA "com.abcwyc.pi-agent"), (Join-Path $env:APPDATA "com.abcwyc.pi-agent"))
$baselineLogSizes = @{}
foreach ($log in @($logRoots | Where-Object { Test-Path $_ } |
    ForEach-Object { Get-ChildItem $_ -Filter "server.log" -Recurse -ErrorAction SilentlyContinue })) {
    $baselineLogSizes[$log.FullName] = $log.Length
}
$canaryStartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$canary = Start-Process -FilePath $executable -ArgumentList "--safe-mode" -PassThru
try {
    $verified = $false
    $lastStatus = "no Core status response"
    $identityStatus = "not probed"
    $nodeListenerCount = 0
    $statusAttempts = 0
    $attempt = 0
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(120)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $attempt++
        $canary.Refresh()
        if ($canary.HasExited) { throw "Installed Safe Mode canary exited before Core became ready" }
        $logs = @($logRoots | Where-Object { Test-Path $_ } |
            ForEach-Object { Get-ChildItem $_ -Filter "server.log" -Recurse -ErrorAction SilentlyContinue })
        $origins = @()
        foreach ($log in $logs) {
            if ($baselineLogSizes.ContainsKey($log.FullName) -and $log.Length -le $baselineLogSizes[$log.FullName]) { continue }
            $ports = [regex]::Matches((Get-Content $log.FullName -Raw), 'http://127\.0\.0\.1:(\d+)')
            if ($ports.Count -eq 0) { continue }
            $origins += "http://127.0.0.1:$($ports[$ports.Count - 1].Groups[1].Value)"
        }
        # The installed server can listen before its startup line reaches the
        # log. Only probe loopback listeners owned by this canary's Node child.
        $nodeListeners = @()
        $nodeProcesses = $null
        try {
            $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($canary.Id)" -ErrorAction Stop |
                Where-Object { $_.Name -eq "node.exe" })
            foreach ($node in $nodeProcesses) {
                $nodeListeners += @(Get-NetTCPConnection -State Listen -OwningProcess $node.ProcessId -ErrorAction SilentlyContinue |
                    Where-Object { $_.LocalAddress -eq "127.0.0.1" })
            }
        } catch { }
        $nodeListenerCount = $nodeListeners.Count
        if ($nodeListenerCount -gt 0) {
            $origins = @($nodeListeners | ForEach-Object { "http://127.0.0.1:$($_.LocalPort)" })
        }
        foreach ($origin in @($origins | Sort-Object -Unique)) {
            try {
                $identity = Invoke-WebRequest "$origin/api/desktop/identity" -Headers @{ Origin = $origin } -TimeoutSec 3
                $identityStatus = "http=$([int]$identity.StatusCode)"
            } catch {
                $identityStatus = "request=$($_.Exception.GetType().Name)"
                continue
            }
            if ($identity.StatusCode -ne 204) { continue }
            if ($statusAttempts -ge 2) { break }
            $statusAttempts++
            $statusTimeoutSec = [math]::Min(60, [math]::Max(1, [math]::Ceiling(($deadline - [DateTimeOffset]::UtcNow).TotalSeconds)))
            try {
                # Cold status reads may start Core and three Bridge projections.
                # Give each read a real completion window instead of issuing
                # many short client timeouts against the same server startup.
                $status = Invoke-RestMethod "$origin/api/edupi/status?summary=1" -Headers @{ Origin = $origin } -TimeoutSec $statusTimeoutSec
                $lastStatus = "core=$($status.core.status) projection=$($status.projection.status) g1=$($status.core.capabilities.g1_processor)"
                if ($status.core.status -eq "ready" -and $status.projection.status -eq "ready" -and
                    $status.compatibility.actual.coreCommit -eq $compat.core_runtime.core_commit -and
                    $status.core.capabilities.g1_processor -eq "activation_pending" -and
                    $status.externalSend -eq $false) { $verified = $true; break }
            } catch {
                if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
                    $lastStatus = "http=$([int]$_.Exception.Response.StatusCode)"
                } else {
                    $lastStatus = "request=$($_.Exception.GetType().Name)"
                }
            }
        }
        if ($verified) { break }
        if ($statusAttempts -ge 2) { break }
        Start-Sleep -Seconds 2
    }
    if (!$verified) {
        $diagnosticCodes = @()
        foreach ($root in $logRoots) {
            if (!(Test-Path $root)) { continue }
            foreach ($file in @(Get-ChildItem $root -Filter "startup-diagnostics.jsonl" -Recurse -File -ErrorAction SilentlyContinue)) {
                foreach ($line in @(Get-Content $file.FullName -Tail 20 -ErrorAction SilentlyContinue)) {
                    try {
                        $entry = $line | ConvertFrom-Json -ErrorAction Stop
                        if ([long]$entry.at -ge $canaryStartedAt) {
                            $diagnosticCodes += "$($entry.stage)/$($entry.component)/$($entry.errorCode)"
                        }
                    } catch { }
                }
            }
        }
        $advancedLog = @($logs | Where-Object { !$baselineLogSizes.ContainsKey($_.FullName) -or $_.Length -gt $baselineLogSizes[$_.FullName] }).Count -gt 0
        $codes = if ($diagnosticCodes.Count) { ($diagnosticCodes | Select-Object -Unique) -join ";" } else { "none" }
        $nodeChildren = if ($null -eq $nodeProcesses) { -1 } else { @($nodeProcesses).Count }
        throw "Installed Safe Mode canary did not prove a ready Core with G1 default-off: $lastStatus; identity=$identityStatus; native=$codes; serverLogAdvanced=$advancedLog; nodeChildren=$nodeChildren; nodeListeners=$nodeListenerCount; probes=$attempt; statusAttempts=$statusAttempts"
    }
    Write-Output "Windows installed preview Safe Mode canary: Core/projection ready, exact pin, G1 pending, external send off."
} finally {
    Stop-InstalledPreviewProcesses
}
} finally {
    try { Stop-InstalledPreviewProcesses } finally {
        foreach ($root in @($testRoot, $canaryRoot)) {
            if ($root -and (Test-Path -LiteralPath $root)) {
                Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
