# Downloads the morphing code of Forsch et al. (GitLab forsch/traveltimemaps, tag
# "publication", commit 4919c316) and the libraries it needs, into lib\ and src\
# next to this script.
#
#   powershell -ExecutionPolicy Bypass -File "$HOME\OneDrive\Desktop\AP\forsch\get_forsch.ps1"
#
# Only the three modules MorphApp uses are fetched (util, isochronedataobjects,
# schematicmorph). GeoTools is not downloaded: shims\ stands in for the few
# GeoTools classes the code touches.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = $PSScriptRoot
$lib = Join-Path $root 'lib'
$src = Join-Path $root 'src'
New-Item -ItemType Directory -Force -Path $lib, $src | Out-Null

$central = 'https://repo1.maven.org/maven2'
$gl = 'https://gitlab.igg.uni-bonn.de/api/v4/projects/1246/packages/maven/de/geoinfoBonn/graphLibrary'
$jars = @(
  @("$central/org/locationtech/jts/jts-core/1.18.0/jts-core-1.18.0.jar", 994018),
  @("$central/org/jgrapht/jgrapht-core/1.5.1/jgrapht-core-1.5.1.jar", 1249354),
  @("$central/org/jheaps/jheaps/0.13/jheaps-0.13.jar", 152480),
  @("$central/org/apache/commons/commons-lang3/3.12.0/commons-lang3-3.12.0.jar", 587402),
  @("$central/commons-cli/commons-cli/1.5.0/commons-cli-1.5.0.jar", 58284),
  @("$central/org/apache/commons/commons-math3/3.6.1/commons-math3-3.6.1.jar", 2213560),
  @("$central/org/jdom/jdom2/2.0.6.1/jdom2-2.0.6.1.jar", 327806),
  @("$gl/gl-core/1.0.0/gl-core-1.0.0.jar", 242304),
  @("$gl/gl-io/1.0.0/gl-io-1.0.0.jar", 99275)
)
foreach ($j in $jars) {
  $out = Join-Path $lib ($j[0] -split '/')[-1]
  Invoke-WebRequest -UseBasicParsing -Uri $j[0] -OutFile $out
  $size = (Get-Item $out).Length
  if ($size -ne $j[1]) { Write-Warning "$out is $size bytes, expected $($j[1])" }
}
Write-Host "Jars: $((Get-ChildItem $lib -Filter *.jar).Count) of 9 in $lib"

$api = 'https://gitlab.igg.uni-bonn.de/api/v4/projects/1448/repository'
$n = 0
foreach ($module in 'util', 'isochronedataobjects', 'schematicmorph') {
  for ($page = 1; ; $page++) {
    $items = Invoke-RestMethod -UseBasicParsing -Uri "$api/tree?ref=publication&recursive=true&per_page=100&page=$page&path=$module"
    foreach ($it in $items) {
      if ($it.type -ne 'blob' -or $it.path -notmatch '/src/main/java/.*\.java$') { continue }
      $out = Join-Path $src ($it.path -replace '/', '\')
      New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
      Invoke-WebRequest -UseBasicParsing -Uri "$api/files/$([uri]::EscapeDataString($it.path))/raw?ref=publication" -OutFile $out
      $n++
    }
    if (@($items).Count -lt 100) { break }
  }
}
Write-Host "Source files: $n of 111 in $src"
