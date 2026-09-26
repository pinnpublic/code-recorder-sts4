param(
    [string]$StsHome = 'C:\dev\sts-4.32.2.RELEASE',
    [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pluginJar = Join-Path $projectRoot 'build/artifacts/dev.coderecorder_0.4.2.jar'
if (!(Test-Path $pluginJar)) { throw 'Run scripts/build.ps1 first.' }
$runRoot = Join-Path $projectRoot ('build/update-site-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $runRoot 'source'
$repository = Join-Path $runRoot 'repository'
$config = Join-Path $runRoot 'configuration'
$simple = Join-Path $config 'org.eclipse.equinox.simpleconfigurator'
New-Item -ItemType Directory -Force -Path $simple,$repository,(Join-Path $source 'plugins'),(Join-Path $source 'features') | Out-Null
Copy-Item -LiteralPath $pluginJar -Destination (Join-Path $source 'plugins')
Copy-Item -LiteralPath (Join-Path $projectRoot 'feature/site.xml') -Destination $source
& (Join-Path $JdkHome 'bin/jar.exe') --create --file (Join-Path $source 'features/dev.coderecorder.feature_0.4.2.jar') -C (Join-Path $projectRoot 'feature') feature.xml
if ($LASTEXITCODE -ne 0) { throw 'Feature packaging failed' }
function FileUri([string]$path) { return ([uri]$path).AbsoluteUri }
$bundles = Get-Content (Join-Path $StsHome 'configuration/org.eclipse.equinox.simpleconfigurator/bundles.info') | ForEach-Object {
    if ($_.StartsWith('#')) { $_ } else {
        $parts = $_.Split(','); $parts[2] = FileUri (Join-Path $StsHome $parts[2]); $parts -join ','
    }
}
[IO.File]::WriteAllLines((Join-Path $simple 'bundles.info'), $bundles, [Text.UTF8Encoding]::new($false))
$plugins = Join-Path $StsHome 'plugins'
$framework = Get-ChildItem $plugins -Filter 'org.eclipse.osgi_*.jar' | Select-Object -First 1
$configurator = Get-ChildItem $plugins -Filter 'org.eclipse.equinox.simpleconfigurator_*.jar' | Select-Object -First 1
$launcher = Get-ChildItem $plugins -Filter 'org.eclipse.equinox.launcher_*.jar' | Select-Object -First 1
$settings = @(
    'osgi.bundles=reference:' + (FileUri $configurator.FullName) + '@1:start'
    'osgi.bundles.defaultStartLevel=4'
    'org.eclipse.equinox.simpleconfigurator.configUrl=' + (FileUri (Join-Path $simple 'bundles.info'))
    'osgi.framework=' + (FileUri $framework.FullName)
    'org.eclipse.update.reconcile=false'
    'osgi.configuration.cascaded=false'
    'eclipse.p2.data.area=' + (FileUri (Join-Path $runRoot 'p2'))
)
[IO.File]::WriteAllLines((Join-Path $config 'config.ini'), $settings, [Text.UTF8Encoding]::new($false))
$repoUri = FileUri $repository
& (Join-Path $JdkHome 'bin/java.exe') -jar $launcher.FullName -configuration $config -data (Join-Path $runRoot 'workspace') -nosplash -consoleLog -application org.eclipse.equinox.p2.publisher.UpdateSitePublisher -metadataRepository $repoUri -artifactRepository $repoUri -source $source -publishArtifacts
if ($LASTEXITCODE -ne 0) { throw 'p2 publishing failed' }
if (!(Test-Path (Join-Path $repository 'content.xml')) -or !(Test-Path (Join-Path $repository 'artifacts.xml'))) { throw 'Missing p2 repository metadata' }
# Fail packaging if the feature group or category is absent from the actual publisher output.
[xml]$metadata = Get-Content (Join-Path $repository 'content.xml') -Raw -Encoding UTF8
if (!($metadata.repository.units.unit | Where-Object id -eq 'dev.coderecorder.feature.feature.group')) { throw 'Installable feature not found' }
if (!($metadata.repository.units.unit | Where-Object { $_.properties.property | Where-Object { $_.name -eq 'org.eclipse.equinox.p2.type.category' -and $_.value -eq 'true' } })) { throw 'Install category not found' }
# The JDK archive tool produces portable ZIP entry paths for Eclipse's Archive installer.
# Eclipse is a prerequisite, not something this recorder is allowed to provision.
# Non-greedy requirements must be satisfied by the existing IDE; p2 must not pull
# alternative platform bundles from the user's other enabled repositories.
foreach ($unit in $metadata.repository.units.unit) {
    foreach ($requirement in $unit.requires.required) {
        if ($requirement -and $requirement.name -notlike 'dev.coderecorder*') {
            $requirement.SetAttribute('greedy', 'false')
        }
    }
}
# Express conflicts in the published p2 metadata rather than changing the user's
# global repository settings or installing replacements for IDE components.
[xml]$compatibility = Get-Content (Join-Path $projectRoot 'feature/p2-compatibility.xml') -Raw -Encoding UTF8
$recorderUnit = $metadata.repository.units.unit | Where-Object id -eq 'dev.coderecorder'
foreach ($requirement in $compatibility.requires.required) {
    [void]$recorderUnit.requires.AppendChild($metadata.ImportNode($requirement, $true))
}
$recorderUnit.requires.SetAttribute('size', [string]$recorderUnit.requires.ChildNodes.Count)
$metadata.Save((Join-Path $repository 'content.xml'))
$archive = Join-Path $projectRoot 'dist/code-recorder-sts4-update-site-0.4.2.zip'
& (Join-Path $JdkHome 'bin/jar.exe') --create --file $archive --no-manifest -C $repository .
if ($LASTEXITCODE -ne 0) { throw 'Update site archive failed' }
Write-Output "Update site: $archive"
Write-Output "Repository: $repository"
