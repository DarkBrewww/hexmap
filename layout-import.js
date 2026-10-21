/* Validate Hex Map Layouts exports without altering their projected geometry. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HexLayoutImport = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const SQRT3 = Math.sqrt(3);
  const DIRECTIONS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const MODES = ["generated", "nyu-fixed"];
  const SHAPES = ["flat-side", "flat-base"];
  const LIMIT = 100000;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const coordinate = value => finite(value) && Math.abs(value) <= LIMIT;
  const point = value => Array.isArray(value) && value.length === 2 && value.every(coordinate);
  function requireCondition(condition, message) {
    if (!condition) throw new Error(message);
  }
  function scalar(value) {
    return typeof value === "string" ? value.slice(0, 160) : finite(value) ? value : null;
  }

  function checkProjection(source) {
    requireCondition(object(source), "Source projection metadata is required.");
    requireCondition(typeof source.projection === "string" &&
      /^d3\.geoAlbersUsa\(\)(?:\s+with unchanged defaults\b[^\n]*|\s*)$/.test(source.projection),
    "This viewer requires d3.geoAlbersUsa() projected screen coordinates with unchanged defaults.");
    requireCondition(source.projectionScale === 1070, "The layout projection scale must be 1070.");
    requireCondition(point(source.projectionTranslate) && source.projectionTranslate[0] === 480 && source.projectionTranslate[1] === 250,
      "The layout projection translation must be [480, 250].");
    if (source.sourceSha256 !== undefined) {
      requireCondition(typeof source.sourceSha256 === "string" && /^[a-fA-F0-9]{64}$/.test(source.sourceSha256),
        "The source SHA-256 must contain exactly 64 hexadecimal characters.");
    }
  }

  function parse(payload, expectedIds) {
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); }
      catch (_) { throw new Error("The selected file is not valid JSON."); }
    }
    requireCondition(object(payload) && payload.format === "hex-layout-lab-v2",
      "Choose a hex-layout-lab-v2 JSON export from Hex Map Layouts.");
    requireCondition(Array.isArray(expectedIds) && expectedIds.length > 0 &&
      expectedIds.every(id => typeof id === "string" && /^\d{4}$/.test(id)) &&
      new Set(expectedIds).size === expectedIds.length, "The viewer district IDs are invalid.");
    requireCondition(Array.isArray(payload.candidates) && payload.candidates.length > 0 && payload.candidates.length <= 512,
      "The export must contain between 1 and 512 candidates.");
    checkProjection(payload.source);
    const expected = new Set(expectedIds), candidateIds = new Set();

    return payload.candidates.map((candidate, index) => {
      const prefix = `Candidate ${index + 1}: `;
      const check = (condition, message) => requireCondition(condition, prefix + message);
      check(object(candidate), "invalid candidate data.");
      const id = String(candidate.id ?? index + 1);
      check(/^[A-Za-z0-9_-]{1,64}$/.test(id) && !candidateIds.has(id), "candidate IDs must be unique simple identifiers.");
      candidateIds.add(id);
      const mode = candidate.mode ?? payload.mode;
      check(MODES.includes(mode), "unsupported layout mode.");
      const parameters = object(candidate.parameters) ? candidate.parameters : {};
      const grid = candidate.grid;
      check(object(grid), "missing hex grid definition.");
      const shape = parameters.shape ?? grid.shape;
      check(SHAPES.includes(shape) && grid.shape === shape, "inconsistent or unsupported hex orientation.");
      const step = candidate.step, radius = candidate.radius;
      check(finite(step) && step >= 0.0001 && step <= 10000 && grid.step === step,
        "hex spacing must be positive and match the grid definition.");
      check(finite(radius) && radius > 0 && radius <= step / SQRT3 * (1 + 1e-10),
        "drawn hex radius must be positive and no greater than spacing / sqrt(3).");
      check(point(grid.origin), "grid origin is outside the supported coordinate range.");
      const standard = shape === "flat-side"
        ? [[step, 0], [step / 2, SQRT3 * step / 2]]
        : [[SQRT3 * step / 2, step / 2], [0, step]];
      check(Array.isArray(grid.basis) && grid.basis.length === 2 && grid.basis.every(point) &&
        grid.basis.every((basis, i) => Math.hypot(basis[0] - standard[i][0], basis[1] - standard[i][1]) <= step * 1e-9),
      "grid basis does not match a regular hex lattice in the selected orientation.");
      check(Array.isArray(candidate.cells) && candidate.cells.length === expected.size,
        `expected exactly ${expected.size} assigned districts.`);
      const seenIds = new Set(), occupied = new Map();
      const cells = candidate.cells.map(cell => {
        check(object(cell) && typeof cell.id === "string" && expected.has(cell.id) && !seenIds.has(cell.id),
          "every district ID must appear exactly once; unknown or duplicate ID found.");
        check(coordinate(cell.x) && coordinate(cell.y), "cell coordinates must be finite projected screen units within +/-100000.");
        check(Number.isSafeInteger(cell.q) && Number.isSafeInteger(cell.r) && Math.abs(cell.q) <= 1e6 && Math.abs(cell.r) <= 1e6,
          "axial cell coordinates must be bounded integers.");
        const key = `${cell.q},${cell.r}`;
        check(!occupied.has(key), "two districts occupy the same cell.");
        const x = grid.origin[0] + cell.q * standard[0][0] + cell.r * standard[1][0];
        const y = grid.origin[1] + cell.q * standard[0][1] + cell.r * standard[1][1];
        check(Math.hypot(cell.x - x, cell.y - y) <= step * 1e-7,
          "a cell position does not match its axial grid coordinates.");
        // The assigned district ID is authoritative. originalId and targetId
        // describe the previous NYU occupant and are never used for matching.
        const normalized = {id: cell.id, x: cell.x, y: cell.y, q: cell.q, r: cell.r};
        seenIds.add(cell.id); occupied.set(key, normalized);
        return normalized;
      });
      const neighbors = Object.create(null);
      for (const cell of cells) {
        neighbors[cell.id] = DIRECTIONS.map(([dq, dr]) => occupied.get(`${cell.q + dq},${cell.r + dr}`))
          .filter(Boolean).map(other => other.id);
      }
      const normalizedParameters = {};
      for (const name of ["noise", "transform", "smooth", "shift", "seed"]) {
        const value = scalar(parameters[name]);
        if (value !== null) normalizedParameters[name] = value;
      }
      normalizedParameters.shape = shape;
      normalizedParameters.mode = mode;
      const details = ["noise", "transform", "smooth", "shift"].filter(name => name in normalizedParameters)
        .map(name => `${name} ${normalizedParameters[name]}`).join(", ");
      const label = `Candidate ${id} | ${shape}${details ? " | " + details : ""}`;
      return {
        id, label, mode, shape, step, radius, cells, neighbors,
        grid: {origin: grid.origin.slice(), step, shape, basis: grid.basis.map(basis => basis.slice())},
        metadata: {
          sourceSha256: payload.source.sourceSha256?.toLowerCase() || "",
          exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt.slice(0, 80) : "",
          rank: Number.isInteger(candidate.rank) ? candidate.rank : index + 1,
          parameters: normalizedParameters
        }
      };
    });
  }
  return {parse};
});
