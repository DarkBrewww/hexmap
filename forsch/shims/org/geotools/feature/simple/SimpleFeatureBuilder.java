package org.geotools.feature.simple;

import org.opengis.feature.simple.SimpleFeature;
import org.opengis.feature.simple.SimpleFeatureType;

/** Stand-in for GeoTools, only used by the unused shapefile export. */
public class SimpleFeatureBuilder {
	public SimpleFeatureBuilder(SimpleFeatureType type) {
	}

	public void add(Object value) {
	}

	public SimpleFeature buildFeature(String id) {
		return new SimpleFeature() {
		};
	}
}
