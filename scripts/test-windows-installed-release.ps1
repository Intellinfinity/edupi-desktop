$ErrorActionPreference = "Stop"
$tag = $env:EDUPI_TEST_RELEASE
if ($tag -notmatch '^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw "Invalid release tag" }
$release = Invoke-RestMethod "https://api.github.com/repos/Intellinfinity/edupi-desktop/releases/tags/$tag"
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
$application = Start-Process -FilePath $executable -PassThru
try {
    $response = $null
    $log = $null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $application.Refresh()
        if ($application.HasExited) { throw "Application exited: $($application.ExitCode)" }
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
    if (!$response -or $response.StatusCode -ne 200) { throw "Installed workspace did not become available" }
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
