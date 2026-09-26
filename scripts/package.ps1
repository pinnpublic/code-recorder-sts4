$ErrorActionPreference = 'Stop'
# One distribution format: the Archive-installable p2 update site.
& (Join-Path $PSScriptRoot 'package-update-site.ps1') @args
