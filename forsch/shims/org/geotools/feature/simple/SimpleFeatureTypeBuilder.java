package org.geotools.feature.simple;

import org.opengis.feature.simple.SimpleFeatureType;

/** Stand-in for GeoTools, only used by the unused shapefile export. */
public class SimpleFeatureTypeBuilder {
	public void setName(String name) {
	}

	public SimpleFeatureTypeBuilder length(int length) {
		return this;
	}

	public void add(String name, Class<?> binding) {
	}

	public SimpleFeatureType buildFeatureType() {
		return new SimpleFeatureType() {
		};
	}
}
