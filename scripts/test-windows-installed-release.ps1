$ErrorActionPreference = "Stop"

function Write-SafeLogTail([string]$Path) {
    if (!(Test-Path $Path)) { return }
    Write-Output "--- $([System.IO.Path]::GetFileName($Path)) ($((Get-Item $Path).Length) bytes) ---"
    $text = (Get-Content $Path -Tail 120 -ErrorAction SilentlyContinue) -join "`n"
    $text = $text -replace '(?i)\bBearer\s+\S+', 'Bearer [redacted]'
    $text = $text -replace '(?i)(authorization|token|secret|password|api[-_ ]?key)(\s*[:=]\s*)\S+', '$1$2[redacted]'
    Write-Output $text
}

function Write-LaunchDiagnostics([datetime]$Since, [string]$TestDir) {
    Write-Output "--- running desktop processes ---"
    Get-Process -Name "pi-agent-desktop", "msedgewebview2" -ErrorAction SilentlyContinue |
        Select-Object ProcessName, Id, StartTime, Path |
        Format-Table -AutoSize | Out-String | Write-Output

    foreach ($root in @((Join-Path $env:LOCALAPPDATA "com.abcwyc.pi-agent"), (Join-Path $env:APPDATA "com.abcwyc.pi-agent"))) {
        Get-ChildItem $root -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -in @("server.log", "startup-diagnostics.jsonl") } |
            ForEach-Object { Write-SafeLogTail $_.FullName }
    }
    Write-SafeLogTail (Join-Path $TestDir "app-stdout.log")
    Write-SafeLogTail (Join-Path $TestDir "app-stderr.log")

    Write-Output "--- Windows application events ---"
    try {
        Get-WinEvent -FilterHashtable @{ LogName = "Application"; StartTime = $Since.AddSeconds(-5) } -ErrorAction Stop |
            Where-Object { $_.Message -match 'pi-agent-desktop|msedgewebview2|WebView2' } |
            Select-Object -First 20 |
            ForEach-Object {
                $message = $_.Message -replace '(?i)\bBearer\s+\S+', 'Bearer [redacted]'
                Write-Output ("{0:o} provider={1} id={2} level={3}`n{4}" -f $_.TimeCreated, $_.ProviderName, $_.Id, $_.LevelDisplayName, $message)
            }
    } catch {
        Write-Output "Application event log unavailable: $($_.Exception.GetType().Name)"
    }

    $crashRoot = Join-Path $env:LOCALAPPDATA "CrashDumps"
    if (Test-Path $crashRoot) {
        Write-Output "--- crash dump inventory ---"
        Get-ChildItem $crashRoot -File -ErrorAction SilentlyContinue |
            Select-Object Name, Length, LastWriteTimeUtc |
            Format-Table -AutoSize | Out-String | Write-Output
    }
}

$tag = $env:EDUPI_TEST_RELEASE
if ($tag -notmatch '^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw "Invalid release tag" }
if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) { throw "GH_TOKEN is required for release lookup" }
$releaseHeaders = @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = "application/vnd.github+json" }
try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/Intellinfinity/edupi-desktop/releases/tags/$tag" -Headers $releaseHeaders
} finally {
    Remove-Item Env:GH_TOKEN -ErrorAction Stop
    $releaseHeaders.Clear()
}
$assets = @($release.assets | Where-Object { $_.name -match '_x64-setup\.exe$' })
if ($assets.Count -ne 1) { throw "Expected one x64 NSIS installer" }
$testDir = Join-Path $env:RUNNER_TEMP "edupi-install-check"
New-Item -ItemType Directory -Force -Path $testDir | Out-Null
$installer = Join-Path $testDir "setup.exe"
$destination = Join-Path $testDir "application"
Invoke-WebRequest $assets[0].browser_download_url -OutFile $installer
$installation = Start-Process -FilePath $installer -ArgumentList "/S", "/D=$destination" -Wait -PassThru
if ($installation.ExitCode -ne 0) { throw "Installer exit code: $($installation.ExitCode)" }
$executable = Join-Path $destination "pi-agent-desktop.exe"
if (!(Test-Path $executable)) { throw "Installed executable not found" }
$launchStartedAt = Get-Date
$runningAfterInstall = @(Get-Process -Name "pi-agent-desktop" -ErrorAction SilentlyContinue)
if ($runningAfterInstall.Count -gt 1) { throw "Installer left multiple desktop processes running" }
if ($runningAfterInstall.Count -eq 1) {
    $application = $runningAfterInstall[0]
    Write-Output "Installer started the application; verifying PID $($application.Id)."
} else {
    $application = Start-Process -FilePath $executable -PassThru `
        -RedirectStandardOutput (Join-Path $testDir "app-stdout.log") `
        -RedirectStandardError (Join-Path $testDir "app-stderr.log")
}
try {
    $versionParts = [regex]::Match($tag, '^v(\d+)\.(\d+)\.(\d+)')
    $releaseVersion = [version]::new([int]$versionParts.Groups[1].Value, [int]$versionParts.Groups[2].Value, [int]$versionParts.Groups[3].Value)
    if ($releaseVersion -ge [version]::new(0, 3, 38)) {
        $exeVersionText = (Get-Item $executable).VersionInfo.ProductVersion
        if ($exeVersionText -notmatch '^(\d+)\.(\d+)\.(\d+)') { throw "Installed executable version is unavailable" }
        $exeVersion = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
        if ($exeVersion -ne $releaseVersion) { throw "Installed executable version does not match release tag" }
        $resources = Join-Path $destination "resources"
        $componentManifest = Get-Content (Join-Path $resources "component-versions.json") -Raw | ConvertFrom-Json
        if ($componentManifest.appVersion -ne $tag.Substring(1)) { throw "Installed component version does not match release tag" }
        $catalogHost = Join-Path $resources "open-connector/host.mjs"
        $bundledNode = Join-Path $resources "node/node.exe"
        if (!(Test-Path $catalogHost) -or !(Test-Path $bundledNode)) { throw "Installed OpenConnector catalog or Node runtime missing" }
        $env:EDUPI_STAGED_RESOURCES = $resources
        & $bundledNode (Join-Path $PSScriptRoot "test-staged-openconnector.mjs")
        if ($LASTEXITCODE -ne 0) { throw "Installed OpenConnector catalog smoke failed" }
        Remove-Item Env:EDUPI_STAGED_RESOURCES -ErrorAction SilentlyContinue
    }

    $response = $null
    $log = $null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $application.Refresh()
        if ($application.HasExited) {
            Write-LaunchDiagnostics -Since $launchStartedAt -TestDir $testDir
            throw "Application exited: $($application.ExitCode)"
        }
        $logRoots = @((Join-Path $env:LOCALAPPDATA "com.abcwyc.pi-agent"), (Join-Path $env:APPDATA "com.abcwyc.pi-agent"))
        $log = $logRoots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Filter server.log -Recurse -ErrorAction SilentlyContinue } | Select-Object -First 1
        if ($log) {
            $text = Get-Content $log.FullName -Raw
            $ports = [regex]::Matches($text, 'http://127\.0\.0\.1:(\d+)')
            if ($ports.Count) {
                $origin = "http://127.0.0.1:$($ports[$ports.Count - 1].Groups[1].Value)"
                try { $response = Invoke-WebRequest "$origin/api/edupi/workspace" -Headers @{ Origin = $origin } -TimeoutSec 5; break } catch { }
            }
        }
        Start-Sleep -Seconds 2
    }
    if (!$response -or $response.StatusCode -ne 200) {
        Write-LaunchDiagnostics -Since $launchStartedAt -TestDir $testDir
        throw "Installed workspace did not become available"
    }
    $workspace = $response.Content | ConvertFrom-Json
    if (!$workspace.data) { throw "Workspace response has no education data" }

    # A second launch must hand off to the existing process and exit. Without
    # the Tauri single-instance plugin it starts another server/WebView here.
    $secondApplication = Start-Process -FilePath $executable -PassThru
    try {
        Wait-Process -Id $secondApplication.Id -Timeout 10 -ErrorAction SilentlyContinue
        $secondApplication.Refresh()
        if (!$secondApplication.HasExited) { throw "Second launch stayed running" }
        $running = @(Get-Process -Name "pi-agent-desktop" -ErrorAction SilentlyContinue)
        if ($running.Count -ne 1) { throw "Expected one running desktop process, found $($running.Count)" }
    } finally {
        if (!$secondApplication.HasExited) { Stop-Process -Id $secondApplication.Id -Force -ErrorAction SilentlyContinue }
    }

    Write-Output "Verified ${tag}: installer exit 0; application stayed running; workspace HTTP 200; second launch reused the existing process."
} finally {
    if (!$application.HasExited) { Stop-Process -Id $application.Id -ErrorAction SilentlyContinue }
}
