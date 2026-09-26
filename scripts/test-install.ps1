param(
    [string]$TestHome,
    [string]$AdditionalRepository,
    [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'build')) + '\'
$TestHome = [IO.Path]::GetFullPath($TestHome)
if (!$TestHome.StartsWith($buildRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Installation validation must target a disposable Eclipse under this project build directory.'
}
$runRoot = Join-Path $projectRoot ('build/install-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runRoot | Out-Null
$info = Join-Path $TestHome 'configuration/org.eclipse.equinox.simpleconfigurator/bundles.info'
$before = @(Get-Content $info | Where-Object { $_ -and !$_.StartsWith('#') })
Copy-Item -LiteralPath $info -Destination (Join-Path $runRoot 'bundles-before.info')
$launcher = Get-ChildItem (Join-Path $TestHome 'plugins') -Filter 'org.eclipse.equinox.launcher_*.jar' | Select-Object -First 1
$archive = Join-Path $projectRoot 'dist/code-recorder-sts4-update-site-0.4.1.zip'
$repository = 'jar:' + ([uri]$archive).AbsoluteUri + '!/'
if ($AdditionalRepository) { $repository += ',' + $AdditionalRepository }
& (Join-Path $JdkHome 'bin/java.exe') -jar $launcher.FullName -install $TestHome -configuration (Join-Path $TestHome 'configuration') -data (Join-Path $runRoot 'provisioning-workspace') -nosplash -consoleLog -application org.eclipse.equinox.p2.director -repository $repository -installIU dev.coderecorder.feature.feature.group -destination $TestHome -profile DefaultProfile -roaming
if ($LASTEXITCODE -ne 0) { throw 'Actual p2 installation failed' }
$after = @(Get-Content $info | Where-Object { $_ -and !$_.StartsWith('#') })
$platformBefore = @($before | Where-Object { $_ -notmatch '^dev\.coderecorder,' } | Sort-Object)
$platformAfter = @($after | Where-Object { $_ -notmatch '^dev\.coderecorder,' } | Sort-Object)
if (Compare-Object $platformBefore $platformAfter) { throw 'Installation changed existing Eclipse bundles' }
if (!($after -match '^dev\.coderecorder,0\.4\.1,')) { throw 'Installed recorder bundle missing' }
Copy-Item -LiteralPath $info -Destination (Join-Path $runRoot 'bundles-after.info')
Write-Output 'PASS: actual p2 install added only Code Recorder; all existing Eclipse bundles unchanged.'

# Exercise the installed bundle rather than manually injecting the development JAR.
& (Join-Path $PSScriptRoot 'test-sts4.ps1') -StsHome $TestHome -JdkHome $JdkHome -Installed
$testRun = Get-ChildItem (Join-Path $projectRoot 'build') -Directory -Filter 'sts4-test-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$testJar = Join-Path $testRun.FullName 'dev.coderecorder.tests_0.1.0.jar'
if (!(Test-Path (Join-Path $testRun.FullName 'PASS.txt'))) { throw 'Installed recorder integration test failed' }

# Use the standard IDE application twice, including a restart with its persisted view.
$probeLine = 'dev.coderecorder.tests,0.1.0,' + ([uri]$testJar).AbsoluteUri + ',4,false'
[IO.File]::WriteAllLines($info, (@(Get-Content $info) + $probeLine), [Text.UTF8Encoding]::new($false))
try {
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $result = Join-Path $runRoot "startup-$attempt.txt"
        $arguments = @(
            '-Drecorder.startup.result="' + $result + '"'
            '-jar "' + $launcher.FullName + '"'
            '-configuration "' + (Join-Path $TestHome 'configuration') + '"'
            '-data "' + (Join-Path $runRoot 'startup-workspace') + '"'
            '-install "' + $TestHome + '"'
            '-application org.springframework.boot.ide.branding.spring-tools-application'
            '-product org.springframework.boot.ide.branding.sts4'
            '-nosplash -consoleLog'
        )
        $process = Start-Process -FilePath (Join-Path $JdkHome 'bin/java.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runRoot "startup-$attempt.log") -RedirectStandardError (Join-Path $runRoot "startup-$attempt.err")
        if (!$process.WaitForExit(60000)) { throw "Startup check timed out. Inspect $runRoot" }
        if (!(Test-Path $result) -or (Test-Path "$result.failure")) { throw "IDE startup failed. Inspect $runRoot" }
        Get-Content $result
    }
} finally {
    Copy-Item -LiteralPath (Join-Path $runRoot 'bundles-after.info') -Destination $info -Force
}
Set-Content -LiteralPath (Join-Path $runRoot 'PASS.txt') -Value 'p2 install, unchanged platform, editor integration, normal IDE startup and restart: PASS' -Encoding UTF8
Write-Output "Installation validation: $runRoot"
