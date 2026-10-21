"use strict";

// Run: node morph-layout-tests.cjs [path/to/hex-layout-export.json] [--git-baseline | --baseline=path/to/index.html]
// Tests execute the geometry functions from index.html, not a second implementation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = __dirname;
let groups = 0;
function test(name, fn) {
  fn(); groups++;
  console.log(`PASS ${name}`);
}
function near(actual, expected, tolerance = 1e-7, message = "Unexpected geometry") {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
}

function geometryRuntime(html, d3, data, forsch) {
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).find(text => text.includes("function sampleDistrictPart"));
  assert.ok(script, "The morph geometry script was not found");
  const start = script.indexOf("const features = DATA.features;");
  const draw = script.indexOf("// 4. Draw the map.");
  const stop = script.lastIndexOf("// ---------------------------------------------------------------------------", draw);
  assert.ok(start >= 0 && stop > start, "The geometry extraction boundaries changed");
  const shoelace = script.match(/function shoelace\(m\) \{[\s\S]*?\n  \}/);
  assert.ok(shoelace, "The actual area function was not found");
  const context = vm.createContext({d3, DATA: data, FORSCH_DATA: forsch, Float64Array, console});
  vm.runInContext(`(function () {
${script.slice(start, stop)}
${shoelace[0]}
globalThis.geometry = {
  get districts() { return districts; },
  get radius() { return R; }, get step() { return STEP; },
  retarget: typeof retargetGeometry === "function" ? retargetGeometry : null,
  sample(district, part, time, mode) {
    const length = sampleDistrictPart(district, part, time, mode);
    return {x: Array.from(bufX.subarray(0, length)), y: Array.from(bufY.subarray(0, length)), area: shoelace(length)};
  },
  path: pathAtDistrict
};
})();`, context, {filename: "index.html:geometry", timeout: 30000});
  return context.geometry;
}

function pointSegmentDistance(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const denominator = dx * dx + dy * dy;
  const fraction = denominator ? Math.max(0, Math.min(1, ((x-a[0])*dx+(y-a[1])*dy)/denominator)) : 0;
  return Math.hypot(x-a[0]-fraction*dx, y-a[1]-fraction*dy);
}
function liesOnRing(sample, ring, tolerance, label) {
  for (let i = 0; i < sample.x.length; i++) {
    let distance = Infinity;
    for (let j = 0; j < ring.length; j++) distance = Math.min(distance,
      pointSegmentDistance(sample.x[i], sample.y[i], ring[j], ring[(j+1)%ring.length]));
    assert.ok(distance <= tolerance, `${label}: point is ${distance} units from the expected boundary`);
  }
}
function sampleRing(sample) { return sample.x.map((x, i) => [x, sample.y[i]]); }
function expectedCorners(cell, radius, shape) {
  const phase = shape === "flat-side" ? Math.PI / 6 : 0;
  return Array.from({length: 6}, (_, index) => [cell.x+radius*Math.cos(phase+index*Math.PI/3), cell.y+radius*Math.sin(phase+index*Math.PI/3)]);
}
function area(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length-1; i < ring.length; j=i++) sum += ring[j][0]*ring[i][1]-ring[i][0]*ring[j][1];
  return sum/2;
}

function fixture(ids, shape, step = 19) {
  const origin = [250, 100];
  const basis = shape === "flat-side" ? [[step,0],[step/2,Math.sqrt(3)*step/2]] : [[Math.sqrt(3)*step/2,step/2],[0,step]];
  const cells = ids.map((id, i) => {
    const q = i%23, r = Math.floor(i/23);
    return {id, q, r, x:origin[0]+q*basis[0][0]+r*basis[1][0], y:origin[1]+q*basis[0][1]+r*basis[1][1]};
  });
  return {format:"hex-layout-lab-v2", mode:"generated", source:{
    projection:"d3.geoAlbersUsa() with unchanged defaults", projectionScale:1070,
    projectionTranslate:[480,250], coordinateSystem:"Projected screen units; x right, y down."
  }, candidates:[{id:shape,mode:"generated",parameters:{shape},step,radius:step/Math.sqrt(3),
    grid:{origin,basis,step,shape},cells}]};
}

function parseOptions(args) {
  const options = {exportFile: null, baselineFile: null, gitBaseline: false};
  for (const argument of args) {
    if (argument === "--git-baseline") options.gitBaseline = true;
    else if (argument.startsWith("--baseline=")) {
      assert.equal(options.baselineFile, null, "Specify only one --baseline file");
      options.baselineFile = argument.slice("--baseline=".length);
      assert.ok(options.baselineFile, "--baseline requires an HTML file path");
    } else {
      assert.ok(!argument.startsWith("--"), `Unknown option: ${argument}`);
      assert.equal(options.exportFile, null, "Specify only one layout export JSON file");
      options.exportFile = argument;
    }
  }
  assert.ok(!(options.gitBaseline && options.baselineFile), "Use either --git-baseline or --baseline, not both");
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const d3 = await import(pathToFileURL(path.join(root,"node_modules/d3/src/index.js")).href);
  const input = vm.createContext({window:{}});
  for (const file of ["hexmap_data.js", "forsch_map_data.js"]) vm.runInContext(fs.readFileSync(path.join(root,file),"utf8"), input);
  const data = input.window.HEXMAP_DATA, forsch = input.window.FORSCH_MAP_DATA;
  const originalInput = JSON.stringify({data,forsch});
  const latest = fs.readFileSync(path.join(root,"index.html"),"utf8");
  const originalNYU = geometryRuntime(latest,d3,data,forsch);
  const current = geometryRuntime(latest,d3,data,forsch);
  const importer = require("./layout-import.js");
  const ids = Array.from(data.features, feature => feature.properties.geo_fips);
  assert.equal(ids.length,436);

  if (options.gitBaseline || options.baselineFile) {
    const baselineHTML = options.gitBaseline
      ? execFileSync("git",["show","HEAD:index.html"],{cwd:root,encoding:"utf8",maxBuffer:4*1024*1024})
      : fs.readFileSync(path.resolve(options.baselineFile),"utf8");
    const baseline = geometryRuntime(baselineHTML,d3,data,forsch);
    const label = options.gitBaseline ? "Git HEAD" : "the supplied HTML baseline";
    test(`Original NYU geometry matches ${label} in both methods`, () => {
      assert.equal(current.districts.length,baseline.districts.length);
      for (let i = 0; i < ids.length; i++) for (const mode of ["linear","forsch"]) for (const time of [0,0.01,0.12,0.120001,0.25,0.5,0.75,0.99,1]) {
        assert.equal(current.path(current.districts[i],time,mode),baseline.path(baseline.districts[i],time,mode),`${ids[i]} ${mode} at ${time}`);
      }
    });
  } else {
    console.log("SKIP historical geometry comparison: supply --git-baseline or --baseline=path/to/index.html to enable it.");
  }

  const layouts = [];
  if (options.exportFile) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(options.exportFile),"utf8"));
    layouts.push(...importer.parse(payload,ids));
  }
  for (const shape of ["flat-side","flat-base"]) layouts.push(...importer.parse(fixture(ids,shape),ids));
  assert.equal(typeof current.retarget,"function","retargetGeometry must be callable without the DOM");

  for (const layout of layouts) {
    current.retarget(layout);
    const byId = new Map(layout.cells.map(cell => [cell.id,cell]));
    test(`${layout.id}: district assignment and endpoints for both methods`, () => {
      near(current.radius,layout.radius); near(current.step,layout.step);
      for (let i = 0; i < ids.length; i++) {
        const district = current.districts[i], cell = byId.get(district.id);
        assert.ok(cell,`Missing district ${district.id}`);
        near(district.center[0],cell.x,1e-10); near(district.center[1],cell.y,1e-10);
        const target = expectedCorners(cell,layout.radius,layout.shape);
        for (const mode of ["linear","forsch"]) {
          const start = current.sample(district,0,0,mode), end = current.sample(district,0,1,mode);
          const original = originalNYU.sample(originalNYU.districts[i],0,0,"linear");
          liesOnRing(start,sampleRing(original),1e-6,`${district.id} ${mode} start`);
          liesOnRing(original,sampleRing(start),1e-6,`${district.id} ${mode} complete start`);
          liesOnRing(end,target,0.015,`${district.id} ${mode} target`);
          near(Math.abs(end.area),Math.abs(area(target)),0.03,`${district.id} ${mode} target area`);
          for (let p = 1; p < district.parts.length; p++) {
            const island = current.sample(district,p,1,mode);
            for (let k=0;k<island.x.length;k++) { near(island.x[k],cell.x); near(island.y[k],cell.y); }
          }
        }
        const neighbors = new Set(layout.neighbors[district.id]);
        assert.deepEqual([...district.kept,...district.fresh].sort(),[...neighbors].sort());
      }
    });

    test(`${layout.id}: all 101 frames are finite and hybrid area follows Linear`, () => {
      for (const district of current.districts) for (let frame=0;frame<=100;frame++) {
        const time=frame/100;
        const linear=current.sample(district,0,time,"linear"), hybrid=current.sample(district,0,time,"forsch");
        for (const sample of [linear,hybrid]) {
          assert.ok(Number.isFinite(sample.area),`${district.id} area at ${time}`);
          assert.ok(sample.x.every(Number.isFinite)&&sample.y.every(Number.isFinite),`${district.id} coordinates at ${time}`);
        }
        near(Math.abs(hybrid.area),Math.abs(linear.area),Math.max(1e-6,Math.abs(linear.area)*1e-8),`${district.id} area at ${time}`);
      }
    });

    test(`${layout.id}: hybrid phase boundaries and exact endpoints remain continuous`, () => {
      const epsilon = 1e-10;
      for (const district of current.districts) for (const time of [0,0.12,1]) {
        const left=current.sample(district,0,Math.max(0,time-epsilon),"forsch");
        const right=current.sample(district,0,Math.min(1,time+epsilon),"forsch");
        liesOnRing(left,sampleRing(right),0.015,`${district.id} left boundary at ${time}`);
        liesOnRing(right,sampleRing(left),0.015,`${district.id} right boundary at ${time}`);
      }
    });
  }

  test("Resetting to NYU restores the original geometry", () => {
    current.retarget(null);
    for (let i=0;i<ids.length;i++) for (const mode of ["linear","forsch"]) for (const time of [0,0.12,0.5,1])
      assert.equal(current.path(current.districts[i],time,mode),originalNYU.path(originalNYU.districts[i],time,mode));
  });
  test("Import and morph sampling do not mutate source or cached keyframes",()=>assert.equal(JSON.stringify({data,forsch}),originalInput));
  console.log(`\n${groups} test groups passed; ${layouts.length} custom layouts checked across 436 districts.`);
}

main().catch(error => { console.error(error.stack || error); process.exitCode=1; });
