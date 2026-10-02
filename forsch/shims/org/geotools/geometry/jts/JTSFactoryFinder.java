package org.geotools.geometry.jts;

import org.locationtech.jts.geom.GeometryFactory;

/** Stand-in for GeoTools: the code only asks for the default factory. */
public final class JTSFactoryFinder {
	private static final GeometryFactory DEFAULT = new GeometryFactory();

	private JTSFactoryFinder() {
	}

	public static GeometryFactory getGeometryFactory() {
		return DEFAULT;
	}
}
