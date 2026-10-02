package org.geotools.data.shapefile;

import java.io.File;
import java.io.IOException;
import java.nio.charset.Charset;

import org.geotools.feature.DefaultFeatureCollection;

/** Stand-in for GeoTools, only used by the unused shapefile export. */
public class ShapefileDumper {
	public ShapefileDumper(File targetDirectory) {
	}

	public void setCharset(Charset charset) {
	}

	public void setMaxDbfSize(long maxDbfSize) {
	}

	public boolean dump(String fileName, DefaultFeatureCollection features) throws IOException {
		throw new IOException("Shapefile export needs the real GeoTools; this build uses stand-ins.");
	}
}
