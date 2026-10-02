package org.geotools.feature;

import org.opengis.feature.simple.SimpleFeature;

/** Stand-in for GeoTools, only used by the unused shapefile export. */
public class DefaultFeatureCollection {
	public boolean add(SimpleFeature feature) {
		return true;
	}
}
