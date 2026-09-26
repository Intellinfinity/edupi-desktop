$ErrorActionPreference = "Stop"

$bundleDirectory = "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
$installers = @(Get-ChildItem $bundleDirectory -Filter "*-setup.exe" -File)
if ($installers.Count -ne 1) { throw "Expected exactly one Windows preview installer" }

$testRoot = Join-Path $env:RUNNER_TEMP "edupi-route1-preview-$PID"
$destination = Join-Path $testRoot "application"
$dataRoot = Join-Path $testRoot "teacher-data"
$agentDir = Join-Path $testRoot "agent"
New-Item -ItemType Directory -Force -Path $destination, $dataRoot, $agentDir | Out-Null
$env:EDUPI_PROJECT_ROOT = $dataRoot
$env:EDUPI_DATA_ROOT = $dataRoot
$env:EDUPI_DATA_ALLOWED_ROOT = $testRoot
$env:PI_CODING_AGENT_DIR = $agentDir
$env:PI_OFFLINE = "1"

$installation = Start-Process -FilePath $installers[0].FullName -ArgumentList "/S", "/D=$destination" -Wait -PassThru
if ($installation.ExitCode -ne 0) { throw "Preview installer returned a nonzero exit code" }
$executable = Join-Path $destination "pi-agent-desktop.exe"
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

# Core a8fe471 intentionally rejects Windows roots until native filesystem
# attestation exists. Record this exact installed-resource boundary; do not
# inject a fake attestation or label HTTP availability as G1 readiness.
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

$application = @(Get-Process -Name "pi-agent-desktop" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $executable }) | Select-Object -First 1
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
    Write-Output "Windows preview installer started with an isolated data root; Core G1 remains blocked by native_attestation_required."
} finally {
    $application.Refresh()
    if (!$application.HasExited) { Stop-Process -Id $application.Id -ErrorAction SilentlyContinue }
}
