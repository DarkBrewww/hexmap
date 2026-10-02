package org.geotools.geometry.jts;

import org.locationtech.jts.io.WKTReader;

/** Stand-in for GeoTools: a plain JTS reader (no curved geometries). */
public class WKTReader2 extends WKTReader {
	public WKTReader2() {
		super(JTSFactoryFinder.getGeometryFactory());
	}
}
