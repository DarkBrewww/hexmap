#!/bin/sh
# Builds what ownlayout/ needs to run the GridMapPipeline (Meulemans, CGF 2026) on Linux or macOS:
#   build/classes            their code + GeometryCore + our RunPipeline driver (Java 11 bytecode)
#   build/CmdMedialAxis.exe  their medial-axis tool, compiled with CGAL (needs libcgal-dev, g++)
# Their code is GPLv3 and is fetched here instead of being kept in this repo.
# On Windows, take CmdMedialAxis.exe from the paper's Zenodo archive (doi 10.5281/zenodo.19497047).
set -e
cd "$(dirname "$0")"
mkdir -p build/src
[ -d build/src/GridMapPipeline ] || git clone -q https://github.com/tue-alga/GridMapPipeline build/src/GridMapPipeline
[ -d build/src/GeometryCore ] || git clone -q https://github.com/tue-alga/GeometryCore build/src/GeometryCore
git -C build/src/GridMapPipeline checkout -q f1c18c0a938bd526e42d531e3728a85f3f0a0305
git -C build/src/GeometryCore checkout -q c4f7faa617be73243d658bf8cd671aa6482ab950
find build/src/GeometryCore/src build/src/GridMapPipeline/GridmapPipeline/src -name '*.java' > build/sources.txt
echo RunPipeline.java >> build/sources.txt
javac --release 11 -encoding UTF-8 -nowarn -d build/classes @build/sources.txt
cp build/src/GeometryCore/resources/*.png build/classes/
g++ -O2 -std=c++17 -o build/CmdMedialAxis.exe build/src/GridMapPipeline/CmdMedialAxis/sdg-edges.cpp -lgmp -lmpfr
echo "built ownlayout/build/classes and ownlayout/build/CmdMedialAxis.exe"
