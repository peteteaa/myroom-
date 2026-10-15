"""
Procedurally builds a stylized "diorama" bedroom for a three.js portfolio.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P blender/build_room.py
Outputs (next to this script): room.blend, room.glb, preview.png

Units are meters, Blender Z-up (glTF export converts to three.js Y-up).
Interactive objects are separate, named meshes: laptop_screen, laptop_display,
desk_lamp, poster, bookshelf, plant, window_glass.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# ---- Room dimensions (edit these to match your real room) -------------------
ROOM_W = 4.0   # along X
ROOM_D = 3.5   # along Y (back wall at y = ROOM_D)
ROOM_H = 2.7
WALL_T = 0.1

DESK = dict(x0=2.2, x1=3.6, depth=0.7, height=0.75, top=0.04)
BED = dict(width=1.0, length=2.0, frame_h=0.3, mattress_h=0.2)
WINDOW = dict(x0=1.1, x1=2.1, z0=0.9, z1=2.1)

# ---- Scene reset -------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---- Helpers -----------------------------------------------------------------
_materials = {}


def mat(name, color, rough=0.6, metal=0.0, emit=None, emit_strength=0.0, transmission=0.0):
    if name in _materials:
        return _materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if transmission and "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = transmission
    _materials[name] = m
    return m


def _link(name, mesh, material, location=(0, 0, 0), rotation=(0, 0, 0), collection=None):
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = rotation
    if material:
        obj.data.materials.append(material)
    (collection or scene.collection).objects.link(obj)
    return obj


def box(name, x0, y0, z0, x1, y1, z1, material, bevel=0.0, collection=None):
    """Axis-aligned box from min corner to max corner; origin at its center."""
    size = Vector((x1 - x0, y1 - y0, z1 - z0))
    center = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    obj = _link(name, me, material, center, collection=collection)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def cylinder(name, x, y, z0, height, r_bottom, r_top=None, material=None, segments=24, collection=None):
    """Cylinder/cone standing on z0; origin at its base."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=r_bottom, radius2=r_bottom if r_top is None else r_top,
        depth=height, matrix=Matrix.Translation((0, 0, height / 2)),
    )
    bm.to_mesh(me)
    bm.free()
    return _link(name, me, material, (x, y, z0), collection=collection)


def sphere(name, x, y, z, radius, material, scale=(1, 1, 1), collection=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=radius)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return _link(name, me, material, (x, y, z), collection=collection)


def new_collection(name):
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    return col


# ---- Materials ---------------------------------------------------------------
M = dict(
    wall=mat("wall", (0.82, 0.78, 0.72), rough=0.9),
    floor=mat("floor_wood", (0.38, 0.24, 0.14), rough=0.5),
    wood=mat("light_wood", (0.66, 0.5, 0.33), rough=0.55),
    metal=mat("dark_metal", (0.06, 0.06, 0.07), rough=0.35, metal=0.8),
    alu=mat("aluminium", (0.72, 0.73, 0.75), rough=0.3, metal=0.9),
    black=mat("black_plastic", (0.02, 0.02, 0.02), rough=0.4),
    display=mat("display", (0.02, 0.03, 0.06), emit=(0.25, 0.45, 1.0), emit_strength=3.0),
    white=mat("linen_white", (0.9, 0.9, 0.88), rough=0.95),
    blanket=mat("blanket_sage", (0.36, 0.47, 0.38), rough=0.95),
    rug=mat("rug_terracotta", (0.62, 0.32, 0.22), rough=1.0),
    fabric=mat("chair_fabric", (0.15, 0.16, 0.18), rough=0.9),
    shade=mat("lamp_shade", (0.95, 0.9, 0.78), rough=0.8, emit=(1.0, 0.8, 0.55), emit_strength=1.5),
    bulb=mat("bulb", (1, 1, 1), emit=(1.0, 0.85, 0.6), emit_strength=8.0),
    glass=mat("glass", (0.8, 0.9, 1.0), rough=0.05, transmission=1.0),
    pot=mat("pot", (0.7, 0.38, 0.25), rough=0.8),
    leaf=mat("leaf", (0.12, 0.38, 0.14), rough=0.7),
    poster_bg=mat("poster_bg", (0.95, 0.55, 0.2), rough=0.8),
    poster_fg=mat("poster_fg", (0.15, 0.12, 0.35), rough=0.8),
)
BOOK_COLORS = [(0.6, 0.12, 0.1), (0.1, 0.25, 0.5), (0.85, 0.7, 0.25), (0.2, 0.45, 0.3), (0.9, 0.88, 0.82), (0.35, 0.2, 0.4)]

W, D, H, T = ROOM_W, ROOM_D, ROOM_H, WALL_T

# ---- Shell: floor + two walls (diorama corner) ---------------------------------
shell = new_collection("room_shell")
box("floor", -T, 0, -T, W, D + T, 0, M["floor"], collection=shell)
box("wall_left", -T, 0, 0, 0, D + T, H, M["wall"], collection=shell)

# Back wall built around the window opening
wx0, wx1, wz0, wz1 = WINDOW["x0"], WINDOW["x1"], WINDOW["z0"], WINDOW["z1"]
box("wall_back_left", 0, D, 0, wx0, D + T, H, M["wall"], collection=shell)
box("wall_back_right", wx1, D, 0, W, D + T, H, M["wall"], collection=shell)
box("wall_back_below", wx0, D, 0, wx1, D + T, wz0, M["wall"], collection=shell)
box("wall_back_above", wx0, D, wz1, wx1, D + T, H, M["wall"], collection=shell)

# Window frame + glass
win = new_collection("window")
f = 0.04
box("window_frame_bottom", wx0, D - 0.06, wz0, wx1, D + T, wz0 + f, M["white"], collection=win)
box("window_frame_top", wx0, D, wz1 - f, wx1, D + T, wz1, M["white"], collection=win)
box("window_frame_left", wx0, D, wz0, wx0 + f, D + T, wz1, M["white"], collection=win)
box("window_frame_right", wx1 - f, D, wz0, wx1, D + T, wz1, M["white"], collection=win)
box("window_frame_mid", (wx0 + wx1) / 2 - f / 2, D, wz0, (wx0 + wx1) / 2 + f / 2, D + T, wz1, M["white"], collection=win)
box("window_glass", wx0, D + T / 2 - 0.005, wz0, wx1, D + T / 2 + 0.005, wz1, M["glass"], collection=win)

# Baseboards
box("baseboard_back", 0, D - 0.015, 0, W, D, 0.08, M["white"], collection=shell)
box("baseboard_left", 0, 0, 0, 0.015, D, 0.08, M["white"], collection=shell)

# ---- Rug -----------------------------------------------------------------------
box("rug", 1.3, 0.6, 0, 3.1, 1.9, 0.012, M["rug"], bevel=0.005)

# ---- Desk ------------------------------------------------------------------------
desk = new_collection("desk")
dx0, dx1, dh, dt = DESK["x0"], DESK["x1"], DESK["height"], DESK["top"]
dy0, dy1 = D - DESK["depth"], D - 0.02
box("desk_top", dx0, dy0, dh - dt, dx1, dy1, dh, M["wood"], bevel=0.008, collection=desk)
leg = 0.04
for i, (lx, ly) in enumerate([(dx0 + 0.03, dy0 + 0.03), (dx1 - 0.03 - leg, dy0 + 0.03),
                              (dx0 + 0.03, dy1 - 0.03 - leg), (dx1 - 0.03 - leg, dy1 - 0.03 - leg)]):
    box(f"desk_leg_{i}", lx, ly, 0, lx + leg, ly + leg, dh - dt, M["metal"], collection=desk)

# ---- Laptop (interactive) --------------------------------------------------------
lap = new_collection("laptop")
lw, ld, lt = 0.32, 0.22, 0.015
lcx, lcy = (dx0 + dx1) / 2, dy0 + 0.32
lz = dh
box("laptop_base", lcx - lw / 2, lcy - ld / 2, lz, lcx + lw / 2, lcy + ld / 2, lz + lt, M["alu"], bevel=0.003, collection=lap)
box("laptop_keyboard", lcx - lw / 2 + 0.02, lcy - 0.01, lz + lt, lcx + lw / 2 - 0.02, lcy + ld / 2 - 0.015, lz + lt + 0.001, M["black"], collection=lap)
box("laptop_trackpad", lcx - 0.05, lcy - ld / 2 + 0.015, lz + lt, lcx + 0.05, lcy - 0.025, lz + lt + 0.001, M["black"], collection=lap)

# Screen lid: origin at the hinge so it can be opened/closed by rotating X in three.js
hinge = Vector((lcx, lcy + ld / 2, lz + lt))
tilt = math.radians(-15)  # negative = leans back toward the wall
sh, st = 0.21, 0.008


def hinged_box(name, x0, x1, y0, y1, z0, z1, material):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(x1 - x0, y1 - y0, z1 - z0), verts=bm.verts)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return _link(name, me, material, hinge, (tilt, 0, 0), collection=lap)


hinged_box("laptop_screen", -lw / 2, lw / 2, -st, 0, 0, sh, M["alu"])
# The glowing display surface — attach your <Html> / video texture to this one
hinged_box("laptop_display", -lw / 2 + 0.012, lw / 2 - 0.012, -st - 0.001, -st, 0.012, sh - 0.012, M["display"])

# ---- Desk lamp (interactive) ------------------------------------------------------
lampc = new_collection("desk_lamp")
lx, ly = dx1 - 0.15, dy1 - 0.15
cylinder("desk_lamp_base", lx, ly, dh, 0.02, 0.08, material=M["metal"], collection=lampc)
cylinder("desk_lamp_pole", lx, ly, dh + 0.02, 0.38, 0.008, material=M["metal"], segments=12, collection=lampc)
cylinder("desk_lamp", lx, ly, dh + 0.33, 0.14, 0.12, 0.06, material=M["shade"], collection=lampc)
sphere("desk_lamp_bulb", lx, ly, dh + 0.36, 0.03, M["bulb"], collection=lampc)

# Mug
cylinder("mug", dx0 + 0.25, dy0 + 0.25, dh, 0.09, 0.04, material=M["white"], collection=desk)

# ---- Chair ---------------------------------------------------------------------
chair = new_collection("chair")
ccx, ccy, cs = lcx, dy0 - 0.25, 0.46
sz = 0.46
box("chair_seat", ccx - cs / 2, ccy - cs / 2, sz - 0.06, ccx + cs / 2, ccy + cs / 2, sz, M["fabric"], bevel=0.02, collection=chair)
box("chair_back", ccx - cs / 2, ccy - cs / 2 - 0.06, sz, ccx + cs / 2, ccy - cs / 2, sz + 0.45, M["fabric"], bevel=0.02, collection=chair)
cylinder("chair_post", ccx, ccy, 0.06, sz - 0.12, 0.025, material=M["metal"], collection=chair)
cylinder("chair_foot", ccx, ccy, 0.0, 0.06, 0.28, 0.2, material=M["metal"], segments=5, collection=chair)

# ---- Bed -----------------------------------------------------------------------
bed = new_collection("bed")
bw, bl, bfh, bmh = BED["width"], BED["length"], BED["frame_h"], BED["mattress_h"]
by0, by1 = D - bl, D
box("bed_frame", 0.02, by0, 0, bw, by1, bfh, M["wood"], bevel=0.01, collection=bed)
box("bed_headboard", 0.02, by1 - 0.06, 0, bw, by1, bfh + bmh + 0.45, M["wood"], bevel=0.01, collection=bed)
box("bed_mattress", 0.05, by0 + 0.03, bfh, bw - 0.03, by1 - 0.06, bfh + bmh, M["white"], bevel=0.04, collection=bed)
box("bed_blanket", 0.03, by0 + 0.01, bfh + 0.04, bw - 0.01, by1 - 0.55, bfh + bmh + 0.04, M["blanket"], bevel=0.04, collection=bed)
box("bed_pillow", 0.15, by1 - 0.45, bfh + bmh, bw - 0.13, by1 - 0.12, bfh + bmh + 0.12, M["white"], bevel=0.05, collection=bed)

# ---- Wall shelves + books (interactive) ----------------------------------------------
shelf = new_collection("bookshelf")
for i, z in enumerate((1.35, 1.75)):
    box(f"bookshelf_{i}", dx0 + 0.1, D - 0.22, z, dx1 - 0.1, D, z + 0.025, M["wood"], bevel=0.004, collection=shelf)
    x = dx0 + 0.15
    for j in range(9 if i == 0 else 6):
        bwid = 0.03 + (j * 7 % 5) * 0.006
        bht = 0.18 + (j * 3 % 4) * 0.025
        color = BOOK_COLORS[(j + i * 2) % len(BOOK_COLORS)]
        bm_ = mat(f"book_{(j + i * 2) % len(BOOK_COLORS)}", color, rough=0.7)
        box(f"book_{i}_{j}", x, D - 0.19, z + 0.025, x + bwid, D - 0.03, z + 0.025 + bht, bm_, collection=shelf)
        x += bwid + 0.004
plant_s = cylinder("shelf_plant_pot", dx1 - 0.3, D - 0.11, 1.775, 0.1, 0.06, 0.07, material=M["pot"], collection=shelf)
sphere("shelf_plant_leaves", dx1 - 0.3, D - 0.11, 1.92, 0.09, M["leaf"], collection=shelf)

# ---- Poster (interactive) ----------------------------------------------------------
box("poster", 0.0, D - 1.45, 1.25, 0.012, D - 0.75, 2.15, M["poster_bg"])
box("poster_art", 0.012, D - 1.3, 1.5, 0.016, D - 0.9, 1.9, M["poster_fg"])

# ---- Floor plant (interactive) -------------------------------------------------------
plant = new_collection("plant")
px, py = W - 0.22, D - 0.25
cylinder("plant_pot", px, py, 0, 0.32, 0.13, 0.16, material=M["pot"], collection=plant)
cylinder("plant_stem", px, py, 0.32, 0.35, 0.012, material=M["leaf"], segments=8, collection=plant)
for i, (ox, oy, oz, r) in enumerate([(0, 0, 0.75, 0.2), (0.1, -0.06, 0.62, 0.15), (-0.09, 0.05, 0.66, 0.14), (0.02, 0.08, 0.9, 0.12)]):
    sphere(f"plant_leaves_{i}", px + ox, py + oy, oz, r, M["leaf"], scale=(1, 1, 0.8), collection=plant)

# Tag interactive objects so three.js can find them via userData (exported as glTF extras)
for name in ("laptop_screen", "laptop_display", "desk_lamp", "poster", "bookshelf_0", "plant_pot", "window_glass", "bed_blanket"):
    bpy.data.objects[name]["interactive"] = True

# ---- Lights (for the Blender preview / baking; three.js adds its own) -------------
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
sun.data.color = (1.0, 0.92, 0.8)
sun.rotation_euler = (math.radians(55), 0, math.radians(200))
scene.collection.objects.link(sun)

fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
fill.data.energy = 250
fill.data.size = 3.0
fill.location = (W / 2, D / 2, H + 0.5)
scene.collection.objects.link(fill)

lamp_light = bpy.data.objects.new("lamp_light", bpy.data.lights.new("lamp_light", "POINT"))
lamp_light.data.energy = 25
lamp_light.data.color = (1.0, 0.8, 0.55)
lamp_light.location = (lx, ly, dh + 0.3)
scene.collection.objects.link(lamp_light)

world = bpy.data.worlds.new("world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.05, 0.07, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
scene.world = world

# ---- Camera ------------------------------------------------------------------
cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
cam.location = (W + 3.2, -3.2, 3.3)
target = Vector((W / 2 - 0.2, D / 2 + 0.2, 0.9))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 35
scene.collection.objects.link(cam)
scene.camera = cam

# ---- Save + export ---------------------------------------------------------------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "room.blend"))

bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT_DIR, "room.glb"),
    export_format="GLB",
    export_apply=True,       # apply bevel modifiers
    export_yup=True,
    export_extras=True,      # custom props -> userData
    export_cameras=False,
    export_lights=False,
)

# ---- Preview render ------------------------------------------------------------
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x, scene.render.resolution_y = 1280, 900
scene.render.filepath = os.path.join(OUT_DIR, "preview.png")
bpy.ops.render.render(write_still=True)
print("DONE:", OUT_DIR)
