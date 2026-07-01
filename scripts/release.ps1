param(
  [Parameter(Mandatory=$true)][string]$Version,
  [string]$AddonVersion = "",
  [string]$ReleaseNotes = "",
  [string]$GitHubOwner = "",
  [string]$GitHubRepo = "",
  [switch]$DryRun
)

# Cut an Alexandria release: bump app version, build + sign the Tauri bundle, pack the
# Windower addon, create a GitHub release (installer + addon zip), and write the two
# updater manifests the app fetches (latest.json for the binary, addon.json for the addon).
# The addon is versioned independently of the app: pass -AddonVersion to bump it, else the
# current addon/Alexandria/Alexandria.lua version is reused.

$ErrorActionPreference = "Stop"
$desktopRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$srcTauri    = Join-Path $desktopRoot "src-tauri"
$tauriConf   = Join-Path $srcTauri "tauri.conf.json"
$packageJson = Join-Path $desktopRoot "package.json"
$cargoToml   = Join-Path $srcTauri "Cargo.toml"
$configPath  = Join-Path $PSScriptRoot "release.config.json"

if (-not (Test-Path $configPath)) { throw "release.config.json missing at $configPath" }
$config = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not $GitHubOwner) { $GitHubOwner = $config.githubOwner }
if (-not $GitHubRepo)  { $GitHubRepo  = $config.githubReleaseRepo }
$platform = $config.platform

if (-not ($Version -match '^\d+\.\d+\.\d+$')) { throw "Version must be semver MAJOR.MINOR.PATCH (got: $Version)" }
if ($AddonVersion -and -not ($AddonVersion -match '^\d+\.\d+\.\d+$')) { throw "AddonVersion must be semver (got: $AddonVersion)" }

if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and -not $env:TAURI_PRIVATE_KEY) {
  Write-Host ""
  Write-Host "ERROR: signing key not found." -ForegroundColor Red
  Write-Host "Set it for this shell, then re-run:" -ForegroundColor Yellow
  Write-Host "  `$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content src-tauri\alexandria-updater.key -Raw"
  Write-Host "  `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<your-key-password>'"
  exit 1
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI 'gh' not found. Install: https://cli.github.com/" }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

Write-Host "==> Bumping app version to $Version" -ForegroundColor Cyan
$pkg = Get-Content $packageJson -Raw | ConvertFrom-Json
$pkg.version = $Version
[IO.File]::WriteAllText($packageJson, ($pkg | ConvertTo-Json -Depth 32), $utf8NoBom)

$conf = Get-Content $tauriConf -Raw | ConvertFrom-Json
$conf.version = $Version
[IO.File]::WriteAllText($tauriConf, ($conf | ConvertTo-Json -Depth 32), $utf8NoBom)

$cargo = Get-Content $cargoToml -Raw
$cargo = [regex]::Replace($cargo, '(?m)^version\s*=\s*"\d+\.\d+\.\d+"', "version = `"$Version`"", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase, [System.TimeSpan]::FromSeconds(2))
[IO.File]::WriteAllText($cargoToml, $cargo, $utf8NoBom)

# Addon version: bump if requested, otherwise read the current value.
$addonSrc = Join-Path $desktopRoot ($config.addonSourcePath -replace '/', '\')
$addonLua = Join-Path $addonSrc "Alexandria.lua"
if (-not (Test-Path $addonLua)) { throw "addon entry not found at $addonLua" }
if ($AddonVersion) {
  $lua = Get-Content $addonLua -Raw
  $lua = [regex]::Replace($lua, "_addon\.version\s*=\s*'[^']*'", "_addon.version = '$AddonVersion'", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase, [System.TimeSpan]::FromSeconds(2))
  [IO.File]::WriteAllText($addonLua, $lua, $utf8NoBom)
  Write-Host "==> Bumped addon version to $AddonVersion"
}
$addonVer = ([regex]::Match((Get-Content $addonLua -Raw), "_addon\.version\s*=\s*'([^']*)'")).Groups[1].Value
if (-not $addonVer) { throw "could not read _addon.version from $addonLua" }
Write-Host "==> Addon version: $addonVer"

Write-Host "==> Building Tauri release bundle (several minutes)" -ForegroundColor Cyan
if (-not $DryRun) {
  Push-Location $desktopRoot
  $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { & cmd /c "npm run tauri build"; $buildExit = $LASTEXITCODE } finally { $ErrorActionPreference = $prevEAP; Pop-Location }
  if ($buildExit -ne 0) { throw "tauri build failed (exit $buildExit)" }
}

$bundleDir = Join-Path $srcTauri "target\release\bundle"
$nsisDir   = Join-Path $bundleDir "nsis"
$installer = Get-ChildItem $nsisDir -Filter "*_${Version}_*-setup.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "\.sig$" } | Select-Object -First 1
if (-not $installer) { throw "no installer for v$Version under $nsisDir (expected *_${Version}_*-setup.exe)" }
$sigFile = "$($installer.FullName).sig"
if (-not (Test-Path $sigFile)) { throw "signature missing: $sigFile (is createUpdaterArtifacts enabled?)" }
$signature = (Get-Content $sigFile -Raw).Trim()

Write-Host "==> Packing addon zip" -ForegroundColor Cyan
$addonZip = Join-Path $bundleDir "Alexandria-addon-$addonVer.zip"
if (Test-Path $addonZip) { Remove-Item $addonZip -Force }
$stage = Join-Path $env:TEMP "alexandria-addon-stage-$addonVer"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
$null = New-Item -ItemType Directory -Path $stage
# Ship the addon source, but never the user's local data/config.
Get-ChildItem $addonSrc -Force | Where-Object {
  $_.Name -ne 'data' -and $_.Name -notmatch '(?i)config.*\.json$' -and $_.Name -notmatch '\.partial$' -and $_.Name -notmatch '_jobs\.json$'
} | ForEach-Object {
  if ($_.PSIsContainer) { Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force }
  else { Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Force }
}
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $addonZip -Force
Remove-Item $stage -Recurse -Force
$addonBytes  = [IO.File]::ReadAllBytes($addonZip)
$sha         = [System.Security.Cryptography.SHA256]::Create()
$addonSha256 = -join ($sha.ComputeHash($addonBytes) | ForEach-Object { $_.ToString("x2") }); $sha.Dispose()
Write-Host ("==> Addon zip: {0:N0} bytes, sha256 {1}" -f $addonBytes.Length, $addonSha256.Substring(0,16))

$notes   = if ($ReleaseNotes) { $ReleaseNotes } else { "Release v$Version" }
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$base    = "https://github.com/$GitHubOwner/$GitHubRepo/releases/download/v$Version"
$appUrl  = "$base/$($installer.Name)"
$addUrl  = "$base/$([IO.Path]::GetFileName($addonZip))"

Write-Host "==> Creating GitHub release v$Version on $GitHubOwner/$GitHubRepo" -ForegroundColor Cyan
if (-not $DryRun) {
  & gh release create "v$Version" $installer.FullName $addonZip --repo "$GitHubOwner/$GitHubRepo" --title "v$Version" --notes "$notes"
  if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
}

# App updater manifest (Tauri format) and addon updater manifest (Alexandria format).
$appManifest = [ordered]@{
  version   = $Version
  notes     = $notes
  pub_date  = $pubDate
  platforms = [ordered]@{ "$platform" = [ordered]@{ signature = $signature; url = $appUrl } }
} | ConvertTo-Json -Depth 32
$addonManifest = [ordered]@{
  addon = [ordered]@{ version = $addonVer; url = $addUrl; sha256 = $addonSha256; notes = $notes }
} | ConvertTo-Json -Depth 32

foreach ($d in $config.manifestDest) {
  $destDir = Join-Path $desktopRoot ($d -replace '/', '\')
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
  [IO.File]::WriteAllText((Join-Path $destDir "latest.json"), $appManifest, $utf8NoBom)
  [IO.File]::WriteAllText((Join-Path $destDir "addon.json"),  $addonManifest, $utf8NoBom)
  Write-Host "==> Wrote latest.json + addon.json to $destDir"
}

Write-Host ""
Write-Host "Release v$Version prepared (addon $addonVer)." -ForegroundColor Green
Write-Host "Next: commit + push your web-deploy repo so gnosis-xi.com serves the new manifests:" -ForegroundColor Yellow
if ($config.PSObject.Properties['deployRepoPath']) {
  Write-Host ("  cd {0}; git add -A; git commit -m `"alexandria v$Version`"; git push" -f $config.deployRepoPath)
}
Write-Host "Then open the PREVIOUS app version and confirm it self-updates."
Write-Host ""
