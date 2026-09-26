param(
    [string]$Version = '0.4.2'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $projectRoot "dist/code-recorder-sts4-update-site-$Version.zip"
if (-not (Test-Path -LiteralPath $archive)) { throw "Build the update-site archive first: $archive" }
$destination = Join-Path $projectRoot 'docs/updates'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
foreach ($name in @('content.xml', 'artifacts.xml')) {
    if (-not (Test-Path -LiteralPath (Join-Path $destination $name))) { throw "Missing repository metadata: $name" }
}
[System.IO.File]::WriteAllText((Join-Path $projectRoot 'docs/.nojekyll'), '')
Write-Output "Prepared: $destination"
Write-Output 'Publish main /docs with GitHub Pages to serve https://pinnpublic.github.io/code-recorder-sts4/updates/'
