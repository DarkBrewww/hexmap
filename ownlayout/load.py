# Shared loader: district geometry exactly as index.html draws it (screen px, y flipped to point up)
import json, os, re
from shapely.geometry import Polygon
from shapely import make_valid, union_all
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

def load():
    h = open(REPO + "/district_morph.html", encoding="utf-8").read()
    data = json.loads(re.search(r'<script type="application/json" id="data">([\s\S]*?)</script>', h).group(1))
    js = open(REPO + "/hexmap_data.js", encoding="utf-8").read()
    hd = json.loads(js[js.index("{"):js.rstrip().rstrip(";").rindex("}") + 1])
    props = {f["properties"]["geo_fips"]: f["properties"] for f in hd["features"]}
    out = []
    for d in data:
        geom = None
        for r in d["r"]:
            p = make_valid(Polygon([(x, -y) for x, y in r]))
            geom = p if geom is None else make_valid(geom.symmetric_difference(p))
        P = props[d["f"]]
        out.append({"fips": d["f"], "name": d["n"], "state": P["state_abbr"], "geom": geom,
                    "map_nb": P["map_neighbors"], "hex_nb": P["hex_neighbors"], "cx": P["cx"], "cy": P["cy"]})
    return out, hd
