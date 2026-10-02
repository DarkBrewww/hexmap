Stand-ins for the GeoTools classes the Forsch et al. code imports, so it compiles
without downloading GeoTools (about 30 jars).

JTSFactoryFinder and WKTReader2 do real work and behave like the GeoTools originals
for this use: a default JTS GeometryFactory and a plain JTS WKT reader.

The feature and shapefile classes only back GeometricUtils.exportVisibilityGraph,
which MorphApp never calls. They compile but refuse to write a shapefile.
