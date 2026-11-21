"""PickSim asset pipeline, step 4 (verification): render a 256 px preview of every final GLB.

  blender -b --factory-startup --python render_previews.py -- --models DIR --out DIR [--only a,b] [--views 4]

Camera: front-right-above relative to the asset's "front" (assets.json, three.js axes), same framing for all.
--views 4 renders the four quadrants (+Z, +X, -Z, -X as "front") into one 2x2 image (used to decide "front").
Writes <out>/<id>.png and <out>/_stats.json (tris, size as seen by Blender).
"""
import bpy, sys, os, json, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1]
    return default

MODELS = arg("--models", os.path.join(HERE, "..", "..", "assets", "models"))
OUT = arg("--out", os.path.join(os.environ.get("TEMP", "."), "picksim-previews"))
ONLY = set(x for x in (arg("--only") or "").split(",") if x)
VIEWS = int(arg("--views", "1"))
RES = int(arg("--res", "256"))
CFG = json.load(open(arg("--list", os.path.join(HERE, "assets.json")), encoding="utf-8"))
os.makedirs(OUT, exist_ok=True)

FRONTS = {"+Z": (0, 0, 1), "-Z": (0, 0, -1), "+X": (1, 0, 0), "-X": (-1, 0, 0)}


def three_to_blender(v):
    x, y, z = v
    return Vector((x, -z, y))


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else ("BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_WORKBENCH")
    try:
        sc.eevee.taa_render_samples = 16
    except Exception:
        pass
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.42, 0.42, 0.42, 1)
    bg.inputs[1].default_value = 1.0
    hdr = os.path.join(HERE, "..", "..", "assets", "hdri", "warehouse_1k.hdr")
    if os.path.exists(hdr):
        # lighting/reflections from the warehouse HDRI, but a neutral grey backdrop for the camera
        N, L = world.node_tree.nodes, world.node_tree.links
        env = N.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdr, check_existing=True)
        bg_env = N.new("ShaderNodeBackground")
        bg_env.inputs[1].default_value = 1.2
        lp = N.new("ShaderNodeLightPath")
        mix = N.new("ShaderNodeMixShader")
        out = N.get("World Output")
        L.new(env.outputs["Color"], bg_env.inputs["Color"])
        L.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
        L.new(bg_env.outputs["Background"], mix.inputs[1])
        L.new(bg.outputs["Background"], mix.inputs[2])
        L.new(mix.outputs["Shader"], out.inputs["Surface"])
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 2.5
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 50
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return sc, so, co


def bbox(objs):
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    return mn, mx


def aim(obj, target):
    d = target - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_view(sc, so, co, objs, front, path):
    mn, mx = bbox(objs)
    ctr = (mn + mx) / 2
    rad = max((mx - mn).length / 2, 0.01)
    F = three_to_blender(FRONTS[front])
    U = Vector((0, 0, 1))
    R = U.cross(F)
    d = (F + 0.75 * R + 0.55 * U).normalized()
    # fit the 8 bbox corners into the (square) frustum with 6 % margin
    t = math.tan(math.atan(36 / 2 / co.data.lens)) / 1.06
    right = U.cross(d).normalized() if abs(d.dot(U)) < 0.999 else Vector((1, 0, 0))
    up = d.cross(right).normalized()
    dist = 0.0
    for cx in (mn.x, mx.x):
        for cy in (mn.y, mx.y):
            for cz in (mn.z, mx.z):
                v = Vector((cx, cy, cz)) - ctr
                dist = max(dist, abs(v.dot(right)) / t + v.dot(d), abs(v.dot(up)) / t + v.dot(d))
    dist = max(dist, rad * 0.5)
    co.location = ctr + d * dist
    aim(co, ctr)
    co.data.clip_start = dist / 100
    co.data.clip_end = dist * 10
    so.location = ctr + (F * 0.6 + R * -0.4 + U).normalized() * dist
    aim(so, ctr)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    stats = {}
    for asset in CFG["assets"]:
        aid = asset["id"]
        if ONLY and aid not in ONLY:
            continue
        glb = os.path.join(MODELS, aid + ".glb")
        if not os.path.exists(glb):
            continue
        sc, so, co = setup_scene()
        bpy.ops.import_scene.gltf(filepath=glb)
        objs = [o for o in sc.objects if o.type == "MESH"]
        tris = 0
        for o in objs:
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
        mn, mx = bbox(objs)
        stats[aid] = {"tris": tris, "size_blender_xyz": [round(v, 3) for v in (mx - mn)]}
        if VIEWS == 1:
            render_view(sc, so, co, objs, asset.get("front", "+Z") if asset.get("front", "n/a") in FRONTS else "+Z",
                        os.path.join(OUT, aid + ".png"))
        else:
            for f in ("+Z", "+X", "-Z", "-X"):
                render_view(sc, so, co, objs, f, os.path.join(OUT, f"{aid}__{f.replace('+', 'p').replace('-', 'm')}.png"))
        print(f"@@ {aid} rendered tris={tris}", flush=True)
    with open(os.path.join(OUT, "_stats.json"), "w", encoding="utf-8") as fh:
        json.dump(stats, fh, indent=1)


main()
