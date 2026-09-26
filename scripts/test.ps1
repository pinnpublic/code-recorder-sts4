param(
    [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$classes = Join-Path $projectRoot 'build/classes'
$output = Join-Path $projectRoot ('build/test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $output | Out-Null
& (Join-Path $JdkHome 'bin/javac.exe') --release 21 -encoding UTF-8 -classpath $classes -d $output (Join-Path $projectRoot 'tests/CoreTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Test compilation failed' }
& (Join-Path $JdkHome 'bin/java.exe') -classpath "$classes;$output" CoreTest $output
if ($LASTEXITCODE -ne 0) { throw 'Java tests failed' }
Write-Output "Core test output: $output"
