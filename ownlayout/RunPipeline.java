package ownmap;

import arrange.DeformAlgorithm;
import assign.AgnosticAlignment;
import assign.AssignAlgorithm;
import assign.AwareAlignment;
import combine.Combination;
import combine.CombineAlgorithm;
import common.SiteMap;
import common.gridmath.GridGeometry;
import common.gridmath.GridGeometrySpawner;
import common.util.Stopwatch;
import io.IO;
import java.io.File;
import partition.CutGenerator;
import partition.CutType;
import partition.PartitionAlgorithm;

/**
 * Runs the four steps of the GridMapPipeline (Meulemans, CGF 2026) without the GUI,
 * with the GUI's defaults unless given otherwise.
 *
 *   java -cp pipeline.jar:driver ownmap.RunPipeline IN.wkt OUT_PREFIX MEDIAL_AXIS_BIN
 *        [productivity=10] [dilation=3] [grid=HEXAGON] [combine=AgglomerativeAssigned] [refine=0] [seed=1]
 *
 * Writes OUT_PREFIX.wkt (all stages) and OUT_PREFIX.tsv/.geojson/.svg (the grid map).
 */
public class RunPipeline {

    public static void main(String[] a) {
        File in = new File(a[0]);
        String out = a[1];
        CutGenerator.command = a[2];
        int productivity = a.length > 3 ? Integer.parseInt(a[3]) : 10;
        double dilation = a.length > 4 ? Double.parseDouble(a[4]) : 3;
        String gridName = a.length > 5 ? a[5] : "HEXAGON";
        String combineName = a.length > 6 ? a[6] : "AgglomerativeAssigned";
        boolean refine = a.length > 7 && a[7].equals("1");
        if (a.length > 8) {   // seed of the cartogram's random moves (their code fixes it to 1)
            try {
                java.lang.reflect.Field f = arrange.util.Random.class.getDeclaredField("random");
                f.setAccessible(true);
                ((java.util.Random) f.get(null)).setSeed(Long.parseLong(a[8]));
            } catch (ReflectiveOperationException ex) {
                throw new RuntimeException(ex);
            }
        }

        GridGeometry grid = GridGeometrySpawner.inferFromString(gridName);
        Combination combine = null;
        for (Combination c : Combination.methods) {
            if (c.toString().equals(combineName)) {
                combine = c;
            }
        }
        if (grid == null || combine == null) {
            throw new IllegalArgumentException("unknown grid or combination");
        }

        SiteMap map = IO.read(in);
        long t0 = System.nanoTime();
        new PartitionAlgorithm(CutType.COMBINED, dilation, productivity, true).run(map);
        int parts = 0;
        for (common.Partition p : map.partitions()) {
            parts++;
        }
        System.out.println("PARTS " + parts);
        new DeformAlgorithm(grid).run(map);
        new AssignAlgorithm(AgnosticAlignment.methods[2], refine ? AwareAlignment.methods[0] : null).run(map);
        new CombineAlgorithm(combine).run(map);
        System.out.printf("TOTAL_SECONDS %.2f%n", (System.nanoTime() - t0) / 1e9);
        Stopwatch.printAndClear();

        IO.write(new File(out + ".wkt"), map);
        IO.exportGridMap(new File(out + ".tsv"), map);
    }
}
