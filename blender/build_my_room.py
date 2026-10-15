"""
Procedurally builds Pete's room (cleaned up) as a diorama for a three.js portfolio.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P blender/build_my_room.py
Outputs (next to this script): my_room.blend, my_room.glb, my_room_preview.png

Layout (looking from the door, which is the open/near side at y = 0):
  - left wall  (x = 0):   low TV stand with TV + vases by the door, separate desk with laptop + 3DS, papers above
  - far wall   (y = D):   big window with wood blinds, Chainsaw Man poster
  - angled corner:        narrow tall window + tall door-window, both with blinds
  - right wall (x = W):   platform bed, posters, jersey, heart, boxing gloves
Units are meters, Blender Z-up (glTF export converts to three.js Y-up).
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
NAME = "my_room"

# ---- Room dimensions (estimated from the photo — edit to match real measurements) ----
W = 3.8    # width, along X
D = 4.6    # depth, along Y (far wall at y = D)
H = 2.6    # wall height
T = 0.1    # wall thickness
CHAMFER_X = 2.4           # far wall turns into the angled corner at this x
CHAMFER_Y = D - 1.0       # angled corner meets the right wall at this y
DESK_H = 0.78
DESK_DEPTH = 0.6

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
    if transmission:
        # alpha-blended glass: renders in Eevee and exports as glTF BLEND
        bsdf.inputs["Alpha"].default_value = 1.0 - 0.85 * transmission
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
        else:
            m.blend_method = "BLEND"
    _materials[name] = m
    return m


def new_collection(name):
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    return col


def _link(name, mesh, material, location=(0, 0, 0), rotation=(0, 0, 0), collection=None):
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = rotation
    if material:
        obj.data.materials.append(material)
    (collection or scene.collection).objects.link(obj)
    return obj


def _add_box(bm, x0, y0, z0, x1, y1, z1, rz=0.0):
    geom = bmesh.ops.create_cube(bm, size=1.0)
    verts = geom["verts"]
    bmesh.ops.scale(bm, vec=(x1 - x0, y1 - y0, z1 - z0), verts=verts)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=verts)
    if rz:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rz, 3, "Z"), verts=verts)


def merged(name, boxes, material, location=(0, 0, 0), rotation=(0, 0, 0), bevel=0.0,
           transform=None, collection=None):
    """One mesh object from many boxes (x0,y0,z0,x1,y1,z1[,rz]) in local coords."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for b in boxes:
        _add_box(bm, *b)
    if transform is not None:
        bmesh.ops.transform(bm, matrix=transform, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    obj = _link(name, me, material, location, rotation, collection)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def box(name, x0, y0, z0, x1, y1, z1, material, bevel=0.0, collection=None):
    return merged(name, [(x0, y0, z0, x1, y1, z1)], material, bevel=bevel, collection=collection)


def cylinder(name, x, y, z0, height, r_bottom, r_top=None, material=None, segments=24,
             rotation=(0, 0, 0), collection=None):
    """Cylinder/cone standing on z0 (origin at its base)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=r_bottom, radius2=r_bottom if r_top is None else r_top,
        depth=height, matrix=Matrix.Translation((0, 0, height / 2)),
    )
    bm.to_mesh(me)
    bm.free()
    return _link(name, me, material, (x, y, z0), rotation, collection)


def sphere(name, x, y, z, radius, material, scale=(1, 1, 1), collection=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=18, v_segments=12, radius=radius)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    obj = _link(name, me, material, (x, y, z), collection=collection)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def text(name, body, size, location, rotation, material, collection=None):
    """Flat 3D text converted to a mesh (so it exports to glTF)."""
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = size
    curve.extrude = 0.001
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    tmp = bpy.data.objects.new(name + "_tmp", curve)
    scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    return _link(name, me, material, location, rotation, collection)



ASSET_DIR = os.path.join(OUT_DIR, "assets")


def import_asset(filename, name, location, fit, uniform=True, rotation=None, drop_materials=(),
                 material_map=None, recolor=None, align=None, part_rotations=None, preprocess=None,
                 collection=None):
    """
    Import a .glb from blender/assets as ONE mesh object called `name`.
      fit:      target size per axis (x, y, z); None = don't care. Uniform scale uses the first given axis.
      location: (x, y, z) -> bbox center x/y and bottom z, unless overridden by align
      align:    optional dict with any of xmin/xmax/ymin/ymax/zcenter to pin a bbox side instead
      drop_materials: material names whose faces get deleted (e.g. fish-tank water)
      material_map:   {imported material name: our material}
      recolor:        list of our materials cycled over every slot (overrides material_map)
      part_rotations: {imported object name: Z angle} spins that part around its own center first
      preprocess:     optional fn(bm) run after `rotation`, before fitting (e.g. re-posing a lid)
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSET_DIR, filename))
    new_objs = [o for o in bpy.data.objects if o not in before]
    bm, mats = bmesh.new(), []
    for o in new_objs:
        if o.type != "MESH":
            continue
        me = o.data.copy()
        me.transform(o.matrix_world)
        if part_rotations and o.name.split(".")[0] in part_rotations:
            center = sum((Vector(v.co) for v in me.vertices), Vector()) / len(me.vertices)
            me.transform(Matrix.Translation(center) @ Matrix.Rotation(part_rotations[o.name.split(".")[0]], 4, "Z")
                         @ Matrix.Translation(-center))
        offset = len(mats)
        mats.extend(me.materials)
        for poly in me.polygons:
            poly.material_index += offset
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    for o in new_objs:
        bpy.data.objects.remove(o)

    base = lambda m: m.name.split(".")[0] if m else ""
    drop = {i for i, m in enumerate(mats) if base(m) in drop_materials}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in drop], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    if rotation is not None:
        bmesh.ops.transform(bm, matrix=rotation, verts=bm.verts)
    if preprocess is not None:
        preprocess(bm)

    def bounds():
        xs, ys, zs = zip(*(v.co[:] for v in bm.verts))
        return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))

    lo, hi = bounds()
    size = hi - lo
    factors = [fit[i] / size[i] if fit[i] else None for i in range(3)]
    if uniform:
        f = next(f for f in factors if f)
        factors = [f, f, f]
    else:
        factors = [f or 1.0 for f in factors]
    bmesh.ops.scale(bm, vec=factors, verts=bm.verts)

    lo, hi = bounds()
    target = Vector((location[0] - (lo.x + hi.x) / 2, location[1] - (lo.y + hi.y) / 2, location[2] - lo.z))
    align = align or {}
    if "xmin" in align: target.x = align["xmin"] - lo.x
    if "xmax" in align: target.x = align["xmax"] - hi.x
    if "ymin" in align: target.y = align["ymin"] - lo.y
    if "ymax" in align: target.y = align["ymax"] - hi.y
    if "zcenter" in align: target.z = align["zcenter"] - (lo.z + hi.z) / 2
    if "zmax" in align: target.z = align["zmax"] - hi.z
    bmesh.ops.translate(bm, vec=target, verts=bm.verts)

    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    material_map = material_map or {}
    for i, m in enumerate(mats):
        me.materials.append(recolor[i % len(recolor)] if recolor else material_map.get(base(m), m))
    obj = _link(name, me, None, collection=collection)
    return obj


def split_by_material(obj, material_name, new_name, new_material=None):
    """Move the faces using `material_name` out of obj into a new object (e.g. a laptop's screen)."""
    idx = [i for i, m in enumerate(obj.data.materials) if m and m.name.split(".")[0] == material_name]
    part = obj.data.copy()
    part.name = new_name
    for me, keep_idx in ((part, True), (obj.data, False)):
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if (f.material_index in idx) != keep_idx], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(me)
        bm.free()
    if new_material:
        for i in idx:
            part.materials[i] = new_material
    new_obj = bpy.data.objects.new(new_name, part)
    obj.users_collection[0].objects.link(new_obj)
    return new_obj


# Text/flat-item orientations for each wall (face into the room, read left-to-right)
FACE_RIGHT_WALL = (math.radians(90), 0, math.radians(-90))   # faces -X
FACE_FAR_WALL = (math.radians(90), 0, 0)                     # faces -Y
FACE_LEFT_WALL = (math.radians(90), 0, math.radians(90))     # faces +X


# ---- Materials ---------------------------------------------------------------
M = dict(
    wall=mat("wall_greige", (0.42, 0.39, 0.34), rough=0.9),
    trim=mat("trim_white", (0.85, 0.85, 0.83), rough=0.6),
    floor=mat("floor_dark_wood", (0.035, 0.022, 0.016), rough=0.35),
    mat_blue=mat("foam_mat_blue", (0.02, 0.15, 0.65), rough=0.85),
    desk=mat("desk_dark_wood", (0.08, 0.045, 0.03), rough=0.45),
    blinds=mat("blinds_wood", (0.16, 0.08, 0.04), rough=0.6),
    glass=mat("glass", (0.85, 0.9, 1.0), rough=0.05, transmission=1.0),
    daylight=mat("daylight", (1, 1, 1), emit=(1.0, 0.95, 0.85), emit_strength=6.0),
    pine=mat("bed_pine", (0.5, 0.3, 0.16), rough=0.6),
    sheet=mat("sheet_grey", (0.16, 0.16, 0.17), rough=0.95),
    blanket=mat("blanket_grey", (0.35, 0.35, 0.36), rough=1.0),
    black=mat("black_plastic", (0.015, 0.015, 0.017), rough=0.5),
    mesh=mat("chair_mesh", (0.03, 0.03, 0.035), rough=0.8),
    chrome=mat("chrome", (0.8, 0.8, 0.82), rough=0.15, metal=1.0),
    alu=mat("aluminium", (0.6, 0.61, 0.63), rough=0.3, metal=0.9),
    display=mat("display", (0.02, 0.03, 0.06), emit=(0.3, 0.5, 1.0), emit_strength=3.0),
    paper=mat("paper", (0.82, 0.8, 0.75), rough=0.9),
    dresser=mat("dresser_grey", (0.22, 0.22, 0.23), rough=0.6),
    white=mat("white", (0.85, 0.85, 0.85), rough=0.5),
    lamp=mat("lamp_white", (0.9, 0.9, 0.88), rough=0.4, emit=(1, 0.9, 0.75), emit_strength=0.5),
    red=mat("plush_red", (0.6, 0.05, 0.06), rough=1.0),
    sky=mat("plush_light_blue", (0.35, 0.6, 0.85), rough=1.0),
    cream=mat("plush_cream", (0.85, 0.78, 0.65), rough=1.0),
    poster_dark=mat("poster_dark", (0.04, 0.04, 0.05), rough=0.8),
    poster_cream=mat("poster_cream", (0.78, 0.76, 0.7), rough=0.8),
    green=mat("ink_green", (0.08, 0.4, 0.12), rough=0.8),
    blue_ink=mat("ink_blue", (0.15, 0.3, 0.55), rough=0.8),
    jersey_blue=mat("jersey_blue", (0.1, 0.3, 0.6), rough=0.8),
    csm_red=mat("ink_red", (0.7, 0.05, 0.05), rough=0.8),
    glove_white=mat("glove_white", (0.85, 0.85, 0.85), rough=0.35),
    glove_black=mat("glove_black", (0.02, 0.02, 0.02), rough=0.35),
)


# ---- Walls -------------------------------------------------------------------
def wall(name, p0, p1, openings=(), ext0=0.0, ext1=0.0, collection=None):
    """
    A wall from p0 to p1 (room interior on the right when walking p0 -> p1),
    with rectangular openings (u0, u1, z0, z1) measured along the wall.
    Adds trim, glass, closed-ish wood blinds and a daylight plane per opening.
    Returns the wall's local->world matrix.
    """
    p0, p1 = Vector((*p0, 0)), Vector((*p1, 0))
    d = (p1 - p0).normalized()
    n = Vector((-d.y, d.x, 0))  # outward
    L = (p1 - p0).length
    Mx = Matrix(((d.x, n.x, 0, p0.x), (d.y, n.y, 0, p0.y), (0, 0, 1, 0), (0, 0, 0, 1)))

    pieces, cursor = [], -ext0
    for u0, u1, z0, z1 in sorted(openings):
        pieces.append((cursor, 0, 0, u0, T, H))
        pieces.append((u0, 0, 0, u1, T, z0))
        pieces.append((u0, 0, z1, u1, T, H))
        cursor = u1
    pieces.append((cursor, 0, 0, L + ext1, T, H))
    merged(name, [p for p in pieces if p[3] - p[0] > 1e-4 and p[5] - p[2] > 1e-4],
           M["wall"], transform=Mx, collection=collection)

    # baseboard
    base = []
    cursor = 0.0
    for u0, u1, z0, z1 in sorted(openings):
        if z0 < 0.1:
            base.append((cursor, -0.015, 0, u0, 0, 0.09))
            cursor = u1
    base.append((cursor, -0.015, 0, L, 0, 0.09))
    merged(f"{name}_baseboard", [b for b in base if b[3] - b[0] > 1e-4], M["trim"],
           transform=Mx, collection=collection)

    for i, (u0, u1, z0, z1) in enumerate(openings):
        f = 0.06
        trim = [
            (u0 - f, -0.02, z1, u1 + f, 0, z1 + f),
            (u0 - f, -0.02, z0, u0, 0, z1),
            (u1, -0.02, z0, u1 + f, 0, z1),
        ]
        if z0 > 0.1:
            trim.append((u0 - f, -0.06, z0 - f, u1 + f, 0, z0))  # sill
        merged(f"{name}_window_{i}_trim", trim, M["trim"], transform=Mx, collection=collection)
        merged(f"{name}_window_{i}_glass", [(u0, T / 2 - 0.004, z0, u1, T / 2 + 0.004, z1)],
               M["glass"], transform=Mx, collection=collection)
        merged(f"{name}_window_{i}_daylight", [(u0 - 0.1, T + 0.25, z0 - 0.1, u1 + 0.1, T + 0.26, z1 + 0.1)],
               M["daylight"], transform=Mx, collection=collection)
        slats, z = [], z1 - 0.06
        merged(f"{name}_window_{i}_blinds_head", [(u0 + 0.01, -0.06, z, u1 - 0.01, -0.01, z1 - 0.005)],
               M["blinds"], transform=Mx, collection=collection)
        while z > z0 + 0.02:
            slats.append((u0 + 0.02, -0.055, z - 0.04, u1 - 0.02, -0.025, z - 0.005))
            z -= 0.05
        merged(f"{name}_window_{i}_blinds", slats, M["blinds"], transform=Mx, collection=collection)
    return Mx


shell = new_collection("room_shell")
box("floor", -T, 0, -T, W + T, D + T, 0, M["floor"], collection=shell)
wall("wall_left", (0, 0), (0, D), ext1=T, collection=shell)
wall("wall_far", (0, D), (CHAMFER_X, D), openings=[(0.15, 1.35, 0.75, 2.2)], collection=shell)
chamfer_len = math.hypot(W - CHAMFER_X, D - CHAMFER_Y)
wall("wall_corner", (CHAMFER_X, D), (W, CHAMFER_Y),
     openings=[(0.12, 0.55, 0.35, 2.15), (0.78, chamfer_len - 0.12, 0.04, 2.15)],
     ext0=0.04, ext1=0.04, collection=shell)
wall("wall_right", (W, CHAMFER_Y), (W, 0), ext0=T, collection=shell)

def foam_mat_textures(material, size=512, tile=1.0):
    """Taekwondo EVA puzzle-mat look: generated 1 m tile color + normal map (image textures only)."""
    import numpy as np
    rng = np.random.default_rng(7)
    n = size
    c = (np.arange(n) + 0.5) / n                       # 0..1 across the tile (metres)
    X, Y = np.meshgrid(c, c)                           # row index = y (v), column = x (u)

    def blur(a, sigma_px):                             # periodic gaussian blur via FFT
        f = np.fft.fftfreq(n)
        k = np.exp(-2 * (np.pi * sigma_px) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
        return np.real(np.fft.ifft2(np.fft.fft2(a) * k))

    def norm(a):
        return (a - a.mean()) / (a.std() + 1e-9)

    # Jigsaw seam: trapezoid wave (4 teeth per metre) offsetting the straight tile edge
    def wave(t, period=0.25, amp=0.045):
        ph = (t / period) % 1.0
        tri = np.clip(np.abs(ph - 0.5) * 8 - 2.0, -0.5, 0.5)    # steep-sided tab / flat-topped zig-zag
        return tri * 2 * amp

    def wrapd(a):                                      # signed distance to nearest integer edge
        return a - np.round(a)

    d_v = np.abs(wrapd(X - wave(Y)))                   # vertical seams (at x = 0 / 1)
    d_h = np.abs(wrapd(Y - wave(X + 0.125)))           # horizontal seams (at y = 0 / 1)
    d = np.minimum(d_v, d_h)
    seam_w = 0.0045
    groove = 1.0 - np.clip(d / seam_w, 0, 1) ** 2      # 1 in the seam centre
    halo = np.exp(-(d / 0.014) ** 2)                   # soft darkening near the seam

    # Pebbled / tatami-like grain
    grain = norm(blur(rng.standard_normal((n, n)), 0.9)) * 0.6 + norm(blur(rng.standard_normal((n, n)), 2.2)) * 0.4
    height = grain * 0.35 - groove * 3.0 - halo * 0.3

    # Base color: blue with soft mottling, darker seams
    mott = norm(blur(rng.standard_normal((n, n)), 20)) * 0.04 + norm(blur(rng.standard_normal((n, n)), 0.9)) * 0.03
    base = np.array([0.15, 0.42, 0.84])                # sRGB of the original (0.02, 0.15, 0.65)
    col = base[None, None, :] * (1.0 + mott[..., None]) * (1.0 - 0.5 * groove - 0.15 * halo)[..., None]
    col = np.clip(col, 0, 1)

    # Normal map from the height field (periodic gradients, +Y up / OpenGL convention)
    strength = 4.0
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
    dy = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) * 0.5  # rows increase toward -v in image space
    nrm = np.stack([-dx * strength * 0.25, -dy * strength * 0.25, np.ones_like(dx)], axis=-1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    nrm = nrm * 0.5 + 0.5

    def make_image(name, rgb, srgb):
        img = bpy.data.images.new(name, n, n, alpha=False)
        img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
        # Blender image row 0 is the bottom (v = 0), matching our row index = y
        px = np.ones((n, n, 4), dtype=np.float32)
        px[..., :3] = rgb
        img.pixels.foreach_set(px.ravel())
        img.file_format = "PNG"
        img.pack()
        return img

    color_img = make_image("foam_mat_color", col, True)
    normal_img = make_image("foam_mat_normal", nrm, False)

    nt = material.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    t_col = nt.nodes.new("ShaderNodeTexImage")
    t_col.image = color_img
    t_col.extension = "REPEAT"
    t_nrm = nt.nodes.new("ShaderNodeTexImage")
    t_nrm.image = normal_img
    t_nrm.extension = "REPEAT"
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 1.0
    nt.links.new(t_col.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(t_nrm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.85


def uv_world_meters(obj, origin_x, origin_y, tile=1.0):
    """UVs from world x/y so one UV unit = one 1 m tile, starting whole at the footprint corner."""
    me = obj.data
    uv = me.uv_layers.active or me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x - origin_x) / tile, (co.y - origin_y) / tile)


# Blue taekwondo foam puzzle mats (L-shape around the chair and bed): 1 m interlocking tiles, ~2 cm thick
mats = new_collection("foam_mats")
foam_mat_textures(M["mat_blue"])
for _n, _x0, _y0, _x1, _y1 in (("foam_mat_window", 0.65, 2.5, CHAMFER_X, D - 0.15),
                               ("foam_mat_bed", 1.6, 0.6, W - 0.02, 2.5)):
    _o = box(_n, _x0, _y0, 0, _x1, _y1, 0.02, M["mat_blue"], collection=mats)
    uv_world_meters(_o, _x0, _y0)

# ---- Low black TV stand along the left wall, by the door -----------------------------
tvs = new_collection("tv_stand")
stand = import_asset("tv_stand.glb", "tv_stand", (0, 0, 0), fit=(0.46, 1.8, 0.56), uniform=False,   # raised to 56 cm
                     rotation=Matrix.Rotation(math.radians(90), 4, "Z"),   # drawers face into the room (+X)
                     align={"xmin": 0.02, "ymin": 0.2},
                     material_map={"frame": M["black"], "legs": M["black"], "Metal": M["chrome"]}, collection=tvs)
STAND_H = max(v.co.z for v in stand.data.vertices)

# Flat-screen TV on the stand — free "TV" model (Jarlan Perez, CC-BY)
tv = import_asset("tv_jarlanperez.glb", "tv", (0.25, 0.95, STAND_H), fit=(None, 0.95, None),
                  rotation=Matrix.Rotation(math.radians(180), 4, "Z"),   # screen faces into the room (+X)
                  material_map={"mat23": M["black"]}, collection=tvs)
# Screen as its own object — put a video texture / <Html> on it in three.js
split_by_material(tv, "mat17", "tv_screen", mat("tv_screen", (0.01, 0.01, 0.015), rough=0.15,
                                                    emit=(0.15, 0.25, 0.5), emit_strength=1.5))

# IKEA FRÖVÄXT vases with poppies, next to the TV — 3D Warehouse model by Shafhan S. (scaled up ~1.6x from its real ~21 cm so it reads in the diorama)
import_asset("vase_frovaxt.glb", "vase", (0.25, 1.72, STAND_H), fit=(None, None, 0.34),
             rotation=Matrix.Rotation(math.radians(90), 4, "Z"), collection=tvs)

# ---- Separate desk by the window, for the laptop -------------------------------------
desk = new_collection("desk")
dy0, dy1 = 2.3, 4.3
box("desk_top", 0.0, dy0, DESK_H - 0.04, DESK_DEPTH, dy1, DESK_H, M["desk"], bevel=0.006, collection=desk)
box("desk_side_0", 0.02, dy0 + 0.02, 0.0, DESK_DEPTH - 0.04, dy0 + 0.06, DESK_H - 0.04, M["desk"], collection=desk)
box("desk_side_1", 0.02, dy1 - 0.06, 0.0, DESK_DEPTH - 0.04, dy1 - 0.02, DESK_H - 0.04, M["desk"], collection=desk)
box("desk_back", 0.02, dy0 + 0.06, 0.3, 0.04, dy1 - 0.06, DESK_H - 0.04, M["desk"], collection=desk)

# Black Stanley cup next to the laptop — Sketchfab "Stanley cup" by Nate (CC-BY), recolored black
stanley_black = mat("stanley_black", (0.02, 0.02, 0.022), rough=0.45, metal=0.3)
import_asset("stanley_cup_nate.glb", "stanley_cup", (0.3, 3.56, DESK_H), fit=(None, None, 0.28),
             rotation=Matrix.Rotation(math.radians(-90), 4, "Z"),     # handle points into the room
             material_map={"Circle": stanley_black, "Plastic": M["black"], "Material": M["black"]},  # body, lid, grip
             collection=desk)

# White planter with a little plant
cylinder("planter", 0.35, 2.75, DESK_H, 0.16, 0.06, 0.07, material=M["white"], collection=desk)
sphere("planter_leaves", 0.35, 2.75, DESK_H + 0.22, 0.07, mat("leaf", (0.15, 0.35, 0.12), rough=0.8), collection=desk)

# Bottles/cups near the window end
for i, (y, h, r) in enumerate([(3.74, 0.25, 0.04), (3.84, 0.2, 0.03), (3.94, 0.28, 0.035)]):
    cylinder(f"bottle_{i}", 0.25, y, DESK_H, h, r, material=M["black"] if i != 1 else M["white"], collection=desk)

# White desk lamp at the window end (interactive) — free "Desk lamp" model (jeremy, CC-BY)
lampc = new_collection("desk_lamp")
import_asset("desk_lamp_jeremy.glb", "desk_lamp", (0.22, 4.16, DESK_H), fit=(None, None, 0.48),
             material_map={"FFFFFF": M["lamp"], "FFEB3B": mat("bulb", (1, 1, 1), emit=(1.0, 0.85, 0.6), emit_strength=8.0), "455A64": M["chrome"]}, collection=lampc)

# ---- Laptop (interactive) — free "Laptop" model (J-Toastie, CC-BY) ----------------------
lap = new_collection("laptop")
laptop = import_asset("laptop_jtoastie.glb", "laptop", (0.36, 3.2, DESK_H), fit=(None, 0.32, None),
                      material_map={"DarkGray": M["black"], "Gray2": M["alu"], "lighterGray": M["alu"]},
                      collection=lap)
# Screen surface as its own object — attach your <Html> screen here
split_by_material(laptop, "Screen", "laptop_display", M["display"])

# ---- Nintendo 3DS XL (interactive, links to peteteaa.vercel.app) — Sketchfab model by Joshua P. Pansdaz (CC-BY) ----
# The model comes posed open and tilted. Rotate it into a "device frame" (bottom screen up = +Z, hinge along X,
# lid towards +Y), close the lid 150° around a hinge pivot, then turn it to face the chair. The lid becomes its own
# object with its origin on the hinge, so three.js can swing it open (see site/main.js).
DS_SITE = "https://peteteaa.vercel.app"
DS_OPEN = math.radians(150)                                # lid angle in the source model
DS_PIVOT = Vector((0.056, 0.0088, 0.1613))                 # hinge pivot in the device frame (source units)
DS_YAW = math.radians(90 + 15)                             # front faces the chair (+X), turned 15° for a casual look
_ds_bottom = Vector((-0.021, -0.524, 0.852)).normalized()  # bottom screen normal in the source model
_ds_top = Vector((-0.141, -0.865, 0.481)).normalized()     # top screen normal in the source model
_ds_x = _ds_bottom.cross(_ds_top).normalized()
DS_FRAME = Matrix((_ds_x, _ds_bottom.cross(_ds_x), _ds_bottom)).to_4x4()


def close_3ds_lid(bm):
    """Tag the lid's loose parts (int layer 'lid' = 1), rotate them shut, and add a marker vertex (2) at the hinge."""
    layer = bm.verts.layers.int.new("lid")
    bm.verts.index_update()
    hinge_y, hinge_z = -0.019, 0.141                       # where the two screen planes meet
    to_base = Vector((0, -1 - math.cos(math.radians(30)), -math.sin(math.radians(30))))   # base dir minus lid dir
    seen = set()
    for v in bm.verts:
        if v.index in seen:
            continue
        part, stack = [], [v]
        seen.add(v.index)
        while stack:
            q = stack.pop()
            part.append(q)
            for e in q.link_edges:
                o = e.other_vert(q)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        on_lid = sum(1 for q in part if Vector((0, q.co.y - hinge_y, q.co.z - hinge_z)).dot(to_base) < 0)
        in_hinge = all(-0.07 < q.co.y < 0.06 and q.co.z < 0.2 for q in part)   # barrels stay with the base
        if on_lid * 2 > len(part) and not in_hinge:
            for q in part:
                q[layer] = 1
    shut = Matrix.Translation(DS_PIVOT) @ Matrix.Rotation(DS_OPEN, 4, "X") @ Matrix.Translation(-DS_PIVOT)
    bmesh.ops.transform(bm, matrix=shut, verts=[v for v in bm.verts if v[layer] == 1])
    bm.verts.new(DS_PIVOT)[layer] = 2
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(DS_YAW, 3, "Z"), verts=bm.verts)


ds_col = new_collection("nintendo_3ds")
ds = import_asset("nintendo_3ds_xl_pansdaz.glb", "nintendo_3ds", (0.45, 2.5, DESK_H), fit=(0.156, None, None),
                  rotation=DS_FRAME, preprocess=close_3ds_lid, collection=ds_col)
# fit=x works because DS_YAW is applied inside preprocess; uniform scale from the device width (15.6 cm)
for img in {n.image for m in ds.data.materials for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image}:
    if img.size[0] > 1024:
        img.scale(1024, 1024)   # source textures are 4K; plenty at desk scale and keeps the .glb small


def recolor_red_to_black(material):
    """The model is the red 3DS XL; turn its red shell (lid top, base bottom) into the black edition, keeping shading."""
    import numpy as np
    img = next(n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE"
               and any(l.to_socket.name == "Base Color" for l in n.outputs[0].links))
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    rgb = px[..., :3]
    redness = np.clip((rgb[..., 0] - rgb[..., 1:].max(-1) - 0.05) / 0.25, 0, 1)[..., None]
    black = np.array([0.045, 0.045, 0.05]) * (0.6 + 0.6 * rgb[..., :1] / 0.7)   # follows the red's light/dark
    px[..., :3] = rgb * (1 - redness) + black * redness
    img.pixels.foreach_set(px.ravel())
    img.pack()


recolor_red_to_black(next(m for m in ds.data.materials if m and m.name.split(".")[0] == "standardSurface1"))

# Split the lid off, origin on the hinge, parented to the base (origin at its bottom center)
bm = bmesh.new()
bm.from_mesh(ds.data)
layer = bm.verts.layers.int["lid"]
pivot = next(v.co.copy() for v in bm.verts if v[layer] == 2)
lid_me = ds.data.copy()
lid_me.name = "nintendo_3ds_lid"
for me, keep in ((lid_me, 1), (ds.data, 0)):
    b = bmesh.new()
    b.from_mesh(me)
    lay = b.verts.layers.int["lid"]
    bmesh.ops.delete(b, geom=[f for f in b.faces if any(v[lay] != keep for v in f.verts)], context="FACES")
    bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context="VERTS")
    b.verts.layers.int.remove(lay)
    b.to_mesh(me)
    b.free()
bm.free()
xs, ys, zs = zip(*(v.co[:] for v in ds.data.vertices))
ds_origin = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
ds.data.transform(Matrix.Translation(-ds_origin))
ds.location = ds_origin
lid_me.transform(Matrix.Translation(-pivot))
ds_lid = bpy.data.objects.new("nintendo_3ds_lid", lid_me)
ds_col.objects.link(ds_lid)
ds_lid.parent = ds
ds_lid.location = pivot - ds_origin
ds["link"] = DS_SITE
# Lid hinge for three.js (Y-up, parent space): rotate by open_angle around hinge_axis to open it
hinge = Matrix.Rotation(DS_YAW, 3, "Z") @ Vector((1, 0, 0))
ds_lid["hinge_axis"] = [hinge.x, hinge.z, -hinge.y]
ds_lid["open_angle"] = -DS_OPEN


def screen_preview(obj, image_file, up):
    """Put a screenshot of the site on the 3DS screen in `obj`, lit like a display: the screen picture (two largest
    'image' triangles) and the tinted glass in front of it (largest 'screen' faces), which would otherwise grey it out.
    up: direction in the object's space that is the top of the picture; picture right is the device's right."""
    me = obj.data
    faces = []
    for layer in ("image", "screen"):
        slot = next(i for i, m in enumerate(me.materials) if m and m.name.split(".")[0] == layer)
        layer_faces = sorted((p for p in me.polygons if p.material_index == slot), key=lambda p: -p.area)
        faces += [p for p in layer_faces if p.area > 0.5 * layer_faces[0].area]
    right = Matrix.Rotation(DS_YAW, 3, "Z") @ Vector((1, 0, 0))
    pts = [me.vertices[i].co for f in faces for i in f.vertices]
    center = sum(pts, Vector()) / len(pts)
    half_u = max(abs((p - center).dot(right)) for p in pts)
    half_v = max(abs((p - center).dot(up)) for p in pts)
    img = bpy.data.images.load(os.path.join(ASSET_DIR, image_file))
    img.pack()
    m = mat(f"ds_screen_{image_file.split('.')[0]}", (1, 1, 1), rough=0.2)
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    me.materials.append(m)
    uv = me.uv_layers.active.data
    for f in faces:
        f.material_index = len(me.materials) - 1
        for li in f.loop_indices:
            d = me.vertices[me.loops[li].vertex_index].co - center
            uv[li].uv = (0.5 + d.dot(right) / (2 * half_u), 0.5 + d.dot(up) / (2 * half_v))


# Screenshots of peteteaa.vercel.app (captured headless at 1000x600 and 600x450) on the top and bottom screens.
# Closed, the lid's top of picture points to the device front; the bottom screen's points towards the hinge.
screen_preview(ds_lid, "peteteaa_preview_top.jpg", Matrix.Rotation(DS_YAW, 3, "Z") @ Vector((0, -1, 0)))
screen_preview(ds, "peteteaa_preview_bottom.jpg", Matrix.Rotation(DS_YAW, 3, "Z") @ Vector((0, 1, 0)))

# ---- Monitor stand behind the laptop (empty top) — wood shelf on dark felt legs, grey tray below ----
MS_X0, MS_X1, MS_Y0, MS_Y1, MS_H = 0.02, 0.23, 2.9, 3.5, 0.11
merged("monitor_stand_top", [(MS_X0, MS_Y0, MS_H - 0.022, MS_X1, MS_Y1, MS_H)],
       mat("stand_wood", (0.36, 0.2, 0.1), rough=0.5), bevel=0.006, location=(0, 0, DESK_H), collection=desk)
merged("monitor_stand_legs", [(MS_X0 + 0.005, MS_Y0 + 0.01, 0.0, MS_X1 - 0.005, MS_Y0 + 0.06, MS_H - 0.022),
                              (MS_X0 + 0.005, MS_Y1 - 0.06, 0.0, MS_X1 - 0.005, MS_Y1 - 0.01, MS_H - 0.022)],
       mat("felt_dark", (0.05, 0.05, 0.055), rough=1.0), bevel=0.004, location=(0, 0, DESK_H), collection=desk)
merged("monitor_stand_tray", [(MS_X0 + 0.015, MS_Y0 + 0.06, 0.012, MS_X1 - 0.01, MS_Y1 - 0.06, 0.022)],
       mat("tray_grey", (0.55, 0.56, 0.57), rough=0.4), bevel=0.002, location=(0, 0, DESK_H), collection=desk)

# ---- Black high-back office chair (interactive) — free "Executive Chair" model (Zsky, CC-BY) ----
chair = new_collection("chair")
import_asset("executive_chair_zsky.glb", "chair", (1.05, 3.2, 0), fit=(None, None, 1.2),
             rotation=Matrix.Rotation(math.radians(-90), 4, "Z"),   # seat faces the desk (-X)
             material_map={"LeatherExecutiveChair1": M["mesh"]}, collection=chair)

# ---- Black mini fridge / cabinet left of the bed head ------------------------------
box("mini_fridge", 1.9, D - 0.62, 0, 2.37, D - 0.12, 0.72, M["black"], bevel=0.01)

# ---- SDAT cassette player on the cabinet (interactive, links to the sdat site) — my own R3F model, exported to .glb ----
# sdat_player.glb has a body and a hinged `sdat_lid` node (three.js Y-up; front = +Z, hinge at the back, axis +X, opens by
# rotation.x = -1.85). Both are baked into world orientation here; the lid becomes a child whose origin is on the hinge.
SDAT_SITE = "https://sdat-beta.vercel.app"
SDAT_OPEN = 1.85                                           # lid angle from the app's Lid animation (rotation.x = -lid * 1.85)
SDAT_YAW = math.radians(-12)                               # front faces -Y, turned a little toward the bed for a casual look
SDAT_W = 0.22                                              # overall width in metres
sdat_col = new_collection("sdat_player")
_before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(ASSET_DIR, "sdat_player.glb"))
_new = [o for o in bpy.data.objects if o not in _before]
_lid_node = next(o for o in _new if o.name.split(".")[0] == "sdat_lid")
_pivot0 = _lid_node.matrix_world.translation.copy()


def _sdat_mesh(name, want_lid):
    bm_, mats_ = bmesh.new(), []
    for o in _new:
        if o.type != "MESH":
            continue
        p, is_lid = o.parent, False
        while p:
            is_lid = is_lid or p is _lid_node
            p = p.parent
        if is_lid != want_lid:
            continue
        me_ = o.data.copy()
        me_.transform(o.matrix_world)
        off = len(mats_)
        mats_.extend(me_.materials)
        for poly in me_.polygons:
            poly.material_index += off
        bm_.from_mesh(me_)
        bpy.data.meshes.remove(me_)
    me_ = bpy.data.meshes.new(name)
    bm_.to_mesh(me_)
    bm_.free()
    for m_ in mats_:
        me_.materials.append(m_)
    return me_


_sd_body_me, _sd_lid_me = _sdat_mesh("sdat_player", False), _sdat_mesh("sdat_lid", True)
for o in _new:
    bpy.data.objects.remove(o)
_sxs, _sys, _szs = zip(*(v.co[:] for v in _sd_body_me.vertices))
_sd_s = SDAT_W / (max(_sxs) - min(_sxs))
_sd_c = Vector(((min(_sxs) + max(_sxs)) / 2, (min(_sys) + max(_sys)) / 2, min(_szs)))   # bottom center
_sd_xf = Matrix.Rotation(SDAT_YAW, 4, "Z") @ Matrix.Scale(_sd_s, 4) @ Matrix.Translation(-_sd_c)
for me_ in (_sd_body_me, _sd_lid_me):
    me_.transform(_sd_xf)
_sd_pivot = _sd_xf @ _pivot0                               # hinge, relative to the body's bottom center
_sd_lid_me.transform(Matrix.Translation(-_sd_pivot))
sdat = bpy.data.objects.new("sdat_player", _sd_body_me)
sdat_col.objects.link(sdat)
sdat.location = (2.21, D - 0.37, 0.72)
sdat_lid = bpy.data.objects.new("sdat_lid", _sd_lid_me)
sdat_col.objects.link(sdat_lid)
sdat_lid.parent = sdat
sdat_lid.location = _sd_pivot
sdat["link"] = SDAT_SITE
_sd_hinge = Matrix.Rotation(SDAT_YAW, 3, "Z") @ Vector((1, 0, 0))   # device's right
sdat_lid["hinge_axis"] = [_sd_hinge.x, _sd_hinge.z, -_sd_hinge.y]
sdat_lid["open_angle"] = -SDAT_OPEN

# SDAT cassettes: 6 tapes (same scale as the player) stacked to the player's left. The site picks one and flies it to
# the bay pose stored on sdat_player (bay_position / bay_quaternion).
_sd_site = "https://sdat-beta.vercel.app/assets/"
SDAT_TRACKS = [
    ("Fly Me to the Moon", "instrumental", "FLY%20ME%20TO%20THE%20MOON%20(Instrumental%20Version)-BzvwAzc3.mp3"),
    ("Ode to Joy", "Beethoven · Rahbari",
     "Evangelion%20-%20Rahbari%20-%20Beethoven%27s%209th%20Symphony%204th%20Movement%20Ode%20to%20Joy-BZc1HJfP.mp3"),
    ("Ryoute Ippai no Yume", "Masami Okui · 1995", "Masami%20Okui%20-%20Ryoute%20Ippai%20no%20Yume%20(1995)-D9xV9xJ4.mp3"),
    ("You Are the Only One", "Lilia · from Ys", "Lilia%20~from%20Ys~%20-%2001%20you%20are%20the%20only%20one-BdjTjf9c.mp3"),
    ("Blue Legend", "Lilia · from Ys", "Lilia%20~from%20Ys~%20-%2003%20blue%20legend-B3BiwMyc.mp3"),
    ("Ribbon of the Heart", "Lilia · from Ys",
     "Lilia%20~from%20Ys~%20-%20Ribbon%20of%20the%20Heart%20(Translated%20to%20english%20Sub.%20Espa%C3%B1ol)-Bk9RD-wA.mp3"),
]
SDAT_STACK_XY = (1.995, D - 0.37)                          # to the left (-x) of the player
SDAT_STACK_YAWS = [0.0, 3.5, -2.5, 4.5, -3.5, 2.0]         # degrees of casual jitter, bottom to top
SDAT_STACK_OFF = [(0, 0), (0.002, -0.003), (-0.003, 0.002), (0.003, 0.003), (-0.002, -0.002), (0.002, 0.001)]
_before_c = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(ASSET_DIR, "sdat_cassettes.glb"))
_new_c = [o for o in bpy.data.objects if o not in _before_c]
for i, (_t, _sub, _file) in enumerate(SDAT_TRACKS):
    _node = next(o for o in _new_c if o.name.split(".")[0] == f"cassette_{i}")
    bm_, mats_ = bmesh.new(), []
    for o in _new_c:
        p = o.parent
        while p and p is not _node:
            p = p.parent
        if o.type != "MESH" or p is not _node:
            continue
        me_ = o.data.copy()
        me_.transform(o.matrix_world)
        off = len(mats_)
        mats_.extend(me_.materials)
        for poly in me_.polygons:
            poly.material_index += off
        bm_.from_mesh(me_)
        bpy.data.meshes.remove(me_)
    me_ = bpy.data.meshes.new(f"cassette_{i}")
    bm_.to_mesh(me_)
    bm_.free()
    for m_ in mats_:
        me_.materials.append(m_)
    _cx, _cy, _cz = zip(*(v.co[:] for v in me_.vertices))
    me_.transform(Matrix.Scale(_sd_s, 4) @ Matrix.Translation(-Vector(((min(_cx) + max(_cx)) / 2, (min(_cy) + max(_cy)) / 2,
                                                                       (min(_cz) + max(_cz)) / 2))))
    cas = bpy.data.objects.new(f"sdat_tape_tmp_{i}", me_)
    sdat_col.objects.link(cas)
    cas.location = (SDAT_STACK_XY[0] + SDAT_STACK_OFF[i][0], SDAT_STACK_XY[1] + SDAT_STACK_OFF[i][1],
                    0.72 + 0.0095 + 0.0192 * i)
    cas.rotation_euler = (0, 0, math.radians(90 + SDAT_STACK_YAWS[i]))   # stack turned 90 degrees to fit; yaw only
    cas["cassette"] = True
    cas["track_index"] = i
    cas["track_title"] = _t
    cas["track_subtitle"] = _sub
    cas["track_src"] = _sd_site + _file
for o in _new_c:
    bpy.data.objects.remove(o)
for i in range(6):
    bpy.data.objects[f"sdat_tape_tmp_{i}"].name = f"cassette_{i}"
# Where a loaded tape sits in the bay (app: SLOT = (-0.5, 0.18, 0) in player space, label up, tape flat), world, three.js Y-up
_bay = sdat.location + _sd_xf @ Vector((-0.5, 0.0, 0.18))
sdat["bay_position"] = [_bay.x, _bay.z, -_bay.y]
_bq = Matrix.Rotation(SDAT_YAW, 3, "Z").to_quaternion()      # canonical tape already lies flat; only the player's yaw
sdat["bay_quaternion"] = [_bq.x, _bq.z, -_bq.y, _bq.w]

# ---- Platform bed (interactive) ------------------------------------------------------
bed = new_collection("bed")
bx0, bx1 = W - 1.4, W - 0.02
by1 = CHAMFER_Y - 0.05
by0 = by1 - 1.95
box("bed_rail_left", bx0, by0, 0.18, bx0 + 0.04, by1, 0.3, M["pine"], collection=bed)
box("bed_rail_right", bx1 - 0.04, by0, 0.18, bx1, by1, 0.3, M["pine"], collection=bed)
box("bed_rail_foot", bx0, by0, 0.18, bx1, by0 + 0.04, 0.3, M["pine"], collection=bed)
box("bed_rail_head", bx0, by1 - 0.04, 0.18, bx1, by1, 0.3, M["pine"], collection=bed)
merged("bed_legs", [(x, y, 0, x + 0.06, y + 0.06, 0.18)
                    for x in (bx0, (bx0 + bx1) / 2 - 0.03, bx1 - 0.06) for y in (by0, (by0 + by1) / 2, by1 - 0.06)],
       M["pine"], collection=bed)
merged("bed_slats", [(bx0 + 0.04, y, 0.27, bx1 - 0.04, y + 0.07, 0.29)
                     for y in [by0 + 0.06 + i * 0.13 for i in range(15)]], M["pine"], collection=bed)
box("bed_mattress", bx0 + 0.03, by0 + 0.05, 0.29, bx1 - 0.03, by1 - 0.03, 0.55, M["sheet"], bevel=0.05, collection=bed)
# real puffy pillows (Poly Haven throw pillows, CC0) recoloured grey. The file has two square cushions leaning
# upright; keep one, lay it flat (its thin axis -> Z, found by PCA) and stretch it into a long bed pillow.
def lay_pillow_flat(which):
    def preprocess(bm):
        import numpy as np
        bm.verts.index_update()
        seen, drop = set(), []
        for v in bm.verts:                       # loose parts left of x = 0.03 belong to the first cushion
            if v.index in seen:
                continue
            part, stack = [], [v]
            seen.add(v.index)
            while stack:
                q = stack.pop()
                part.append(q)
                for e in q.link_edges:
                    o = e.other_vert(q)
                    if o.index not in seen:
                        seen.add(o.index)
                        stack.append(o)
            cx = sum(q.co.x for q in part) / len(part)
            if (cx < 0.03) != (which == 0):
                drop.extend(part)
        bmesh.ops.delete(bm, geom=drop, context="VERTS")
        pts = np.array([v.co[:] for v in bm.verts])
        _, vecs = np.linalg.eigh(np.cov((pts - pts.mean(0)).T))   # ascending variance: thin axis first
        axes = vecs[:, ::-1].T                                      # rows: long, mid, thin
        if np.linalg.det(axes) < 0:
            axes[2] *= -1
        bmesh.ops.transform(bm, matrix=Matrix([list(r) for r in axes]).to_4x4(), verts=bm.verts)
    return preprocess


for i, (dx, yaw) in enumerate(((-0.33, 2.5), (0.33, -3.0))):
    _p = import_asset("throw_pillows_serhii_khromov.glb", f"bed_pillow_{i}", ((bx0 + bx1) / 2 + dx, by1 - 0.3, 0.53),
                      fit=(0.64, 0.42, 0.14), uniform=False, preprocess=lay_pillow_flat(i),
                      recolor=[M["sheet"]], collection=bed)
    _c = sum((v.co for v in _p.data.vertices), Vector()) / len(_p.data.vertices)
    _p.data.transform(Matrix.Translation(_c) @ Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Translation(-_c))


def drape_blanket(name, collider, x0, x1, y0, y1, z_start, material, collection):
    """Cloth-sim a blanket falling onto `collider`, then bake it to a plain mesh."""
    nx, ny = 30, 30
    bmg = bmesh.new()
    bmesh.ops.create_grid(bmg, x_segments=nx, y_segments=ny, size=0.5)
    bmesh.ops.scale(bmg, vec=(x1 - x0, y1 - y0, 1), verts=bmg.verts)
    bmesh.ops.translate(bmg, vec=((x0 + x1) / 2, (y0 + y1) / 2, z_start), verts=bmg.verts)
    me = bpy.data.meshes.new(name)
    bmg.to_mesh(me)
    bmg.free()
    ob = _link(name, me, material, collection=collection)
    for p in me.polygons:
        p.use_smooth = True
    col_mod = collider.modifiers.new("collide", "COLLISION")
    col_mod.settings.thickness_outer = 0.01
    col_mod.settings.use_culling = False
    cm = ob.modifiers.new("cloth", "CLOTH")
    cm.settings.quality = 8
    cm.settings.mass = 0.4
    cm.settings.tension_stiffness = 12
    cm.settings.compression_stiffness = 12
    cm.settings.bending_stiffness = 2.0
    cm.collision_settings.distance_min = 0.012
    cm.collision_settings.collision_quality = 4
    col_mod.settings.cloth_friction = 40
    cm.settings.tension_stiffness = 40
    cm.settings.compression_stiffness = 40
    cm.settings.bending_stiffness = 3
    cm.settings.air_damping = 2
    cm.collision_settings.use_self_collision = False
    scene.frame_start, scene.frame_end = 1, 70
    for f in range(1, 71):
        scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = baked
    bpy.data.meshes.remove(old)
    collider.modifiers.remove(col_mod)
    scene.frame_set(1)
    # thicken a little and soften
    sub = ob.modifiers.new("solid", "SOLIDIFY")
    sub.thickness = 0.012
    sub.offset = 1
    for m in list(ob.modifiers):
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


drape_blanket("bed_blanket", bpy.data.objects["bed_mattress"], bx0 - 0.1, bx1 + 0.1, by0 - 0.05, by1 - 0.6, 0.75,
              M["blanket"], bed)

# ---- Grey dresser near the door (right side), pushed up towards the closet mirror -------------------------------
DRESSER_Y = (0.15, 1.05)
dresser = new_collection("dresser")
box("dresser", W - 0.5, DRESSER_Y[0], 0, W - 0.02, DRESSER_Y[1], 0.85, M["dresser"], bevel=0.008, collection=dresser)
merged("dresser_drawer_lines", [(W - 0.505, DRESSER_Y[0] + 0.03, z, W - 0.5, DRESSER_Y[1] - 0.03, z + 0.01)
                                for z in (0.28, 0.56)], M["black"], collection=dresser)

# ---- Pokemon TCG "Scarlet & Violet 151" Elite Trainer Box on the dresser (interactive) ---------------------------
# Own low-poly model. Art = perspective-rectified product photos (assets/etb151_*.jpg); the 5 cards are real card scans
# (assets/cards151/<number>.png, (c) Pokemon / Nintendo / Creatures / GAME FREAK). Front (Snorlax) faces -X, to the room.
# Parts: etb (black inner box) > etb_lid (the whole printed outer box, lifts off), toploader stacks, etb_card_0..4.
# Geometry is baked in world orientation: no object has a rotation.
ETB_W, ETB_D, ETB_H = 0.26, 0.14, 0.235                    # box size along Y, along X, height
ETB_WALL, ETB_GAP, ETB_CLEAR = 0.003, 0.002, 0.003
ETB_XY = (3.55, DRESSER_Y[0] + 0.35)                       # base centre on the dresser top (z = 0.85)
ETB_Z0 = 0.85
ETB_HB = 0.13                                              # black inner box height (taller than the 10 cm toploaders)
ETB_LID_YAW = math.radians(12)
ETB_CARDS = [("151", "Mew ex"), ("199", "Charizard ex"), ("200", "Blastoise ex"), ("198", "Venusaur ex"),
             ("51", "Snorlax")]                            # sv3pt5-151/199/200/198 and svp-51 (names checked via the API)
ETB_CARD_W, ETB_CARD_L, ETB_CARD_T = 0.063, 0.088, 0.0004

import tempfile

import numpy as np


def etb_img_mat(name, path, rough=0.5, jpeg_fill=False):
    img = bpy.data.images.load(path)
    if jpeg_fill:                                          # card scans have transparent rounded corners: fill + JPEG
        w, h = img.size
        a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        edge = a[h // 2, 3, :3].copy()
        al = a[..., 3:4]
        a[..., :3] = a[..., :3] * al + edge * (1 - al)
        a[..., 3] = 1.0
        img = bpy.data.images.new(name + "_tex", w, h)
        img.pixels = a.ravel().tolist()
        img.file_format = "JPEG"
        img.filepath_raw = os.path.join(tempfile.mkdtemp(), name + ".jpg")
        img.save()
        img = bpy.data.images.load(img.filepath_raw)
    img.pack()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = rough
    m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def etb_shell(name, x0, x1, y0, y1, z0, z1, t, kind, loc, mats, uvf):
    """Hollow box. kind 'base': closed bottom, open top; 'lid': closed top, open bottom. Coordinates are in etb space and
    shifted by -loc into the object's local space. mats: [front, back, side+y, side-y, top, plain]. uvf(face, x, y, z)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")

    def quad(pts, mi, face=None):
        f = bm.faces.new([bm.verts.new(Vector(p) - Vector(loc)) for p in pts])
        f.material_index = mi
        for lp, p in zip(f.loops, pts):
            lp[uvl].uv = uvf(face, *p) if face else (0.0, 0.0)

    ix0, ix1, iy0, iy1 = x0 + t, x1 - t, y0 + t, y1 - t
    zb = z0 if kind == "base" else z0
    zi0 = z0 + t if kind == "base" else z0               # inner floor / open bottom
    zi1 = z1 if kind == "base" else z1 - t
    # outer walls (outward normals)
    quad([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], 0, "front")     # -X
    quad([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], 1, "back")      # +X
    quad([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], 2, "left")      # +Y
    quad([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], 3, "right")     # -Y
    # inner walls (normals inward)
    quad([(ix0, iy0, zi0), (ix0, iy1, zi0), (ix0, iy1, zi1), (ix0, iy0, zi1)], 5)
    quad([(ix1, iy1, zi0), (ix1, iy0, zi0), (ix1, iy0, zi1), (ix1, iy1, zi1)], 5)
    quad([(ix1, iy0, zi0), (ix0, iy0, zi0), (ix0, iy0, zi1), (ix1, iy0, zi1)], 5)
    quad([(ix0, iy1, zi0), (ix1, iy1, zi0), (ix1, iy1, zi1), (ix0, iy1, zi1)], 5)
    if kind == "base":
        quad([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], 5)           # bottom, outside
        quad([(ix0, iy0, zi0), (ix1, iy0, zi0), (ix1, iy1, zi0), (ix0, iy1, zi0)], 5)  # floor
        rz, flip = z1, False
    else:
        quad([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], 4, "top")    # top, outside
        quad([(ix0, iy0, zi1), (ix0, iy1, zi1), (ix1, iy1, zi1), (ix1, iy0, zi1)], 5)  # underside
        rz, flip = z0, True
    # rim ring between outer and inner walls
    ring = [((x0, y0), (ix0, iy0)), ((x1, y0), (ix1, iy0)), ((x1, y1), (ix1, iy1)), ((x0, y1), (ix0, iy1))]
    for i in range(4):
        (oa, ia), (ob, ib) = ring[i], ring[(i + 1) % 4]
        pts = [(*oa, rz), (*ob, rz), (*ib, rz), (*ia, rz)]
        quad(pts if not flip else pts[::-1], 5)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    obj = _link(name, me, None, loc, collection=etb_col)
    for m in mats:
        me.materials.append(m)
    return obj


etb_col = new_collection("etb")
_e_hx, _e_hy = ETB_D / 2, ETB_W / 2
_e_fr = mat("etb_white", (0.9, 0.9, 0.9), rough=0.7)
_e_tray = mat("etb_tray", (0.8, 0.82, 0.84), rough=0.7)
_e_art = [etb_img_mat("etb_front", os.path.join(ASSET_DIR, "etb151_front.jpg")),
          etb_img_mat("etb_back", os.path.join(ASSET_DIR, "etb151_back.jpg")),
          etb_img_mat("etb_side_l", os.path.join(ASSET_DIR, "etb151_side.jpg")),
          etb_img_mat("etb_side_r", os.path.join(ASSET_DIR, "etb151_side.jpg")),
          etb_img_mat("etb_top", os.path.join(ASSET_DIR, "etb151_top.jpg")), _e_fr]


def _etb_uv(face, x, y, z):
    """Art coordinates in etb space (x, y from the box centre): the lid and base share one mapping, so art is continuous."""
    cl = lambda v: min(1.0, max(0.0, v))
    v = cl(z / ETB_H)
    if face == "front":
        return (cl((_e_hy - y) / ETB_W), v)
    if face == "back":
        return (cl((y + _e_hy) / ETB_W), v)
    if face == "left":                                     # +Y side, seen from outside the photo's left panel
        return (cl((_e_hx - x) / ETB_D), v)
    if face == "right":                                    # -Y side, mirrored
        return (cl((x + _e_hx) / ETB_D), v)
    return (cl((_e_hy - y) / ETB_W), cl((x + _e_hx) / ETB_D))   # top


# etb = the matte black inner box (bottom of the real product): origin at bottom centre, open top, no art.
# etb_lid = the whole printed outer box (full height, open bottom), a child of etb; it lifts straight off.
_e_blk = mat("etb_black", (0.02, 0.02, 0.022), rough=0.85)
_e_ihx, _e_ihy = _e_hx - ETB_CLEAR - ETB_WALL, _e_hy - ETB_CLEAR - ETB_WALL      # inner box outer half-sizes
etb = etb_shell("etb", -_e_ihx, _e_ihx, -_e_ihy, _e_ihy, 0.0, ETB_HB, ETB_WALL, "base", (0, 0, 0), [_e_blk] * 6,
                lambda *a: (0.0, 0.0))
etb.location = (ETB_XY[0], ETB_XY[1], ETB_Z0)
etb["etb"] = True
etb["interactive"] = True
etb["lid_lift"] = ETB_HB + 0.05                            # metres straight up for the lid to clear the box + 5 cm

_lid_c = Vector((0, 0, ETB_H / 2))
etb_lid = etb_shell("etb_lid", -_e_hx, _e_hx, -_e_hy, _e_hy, 0.0, ETB_H, ETB_GAP, "lid", _lid_c, _e_art, _etb_uv)
etb_lid.parent = etb
etb_lid["etb_lid"] = True

# Lid rest pose: set down upright (open side down) on the dresser at the +Y side of the box, yawed a little.
_lr_c = Vector((ETB_XY[0] - 0.01, ETB_XY[1] + 0.35, ETB_Z0 + ETB_H / 2))           # Blender world
_lr_q = Matrix.Rotation(ETB_LID_YAW, 3, "Z").to_quaternion()                          # (w, x, y, z)
etb["lid_rest_position"] = [_lr_c.x, _lr_c.z, -_lr_c.y]
etb["lid_rest_quaternion"] = [_lr_q.x, _lr_q.z, -_lr_q.y, _lr_q.w]


def etb_part(name, boxes, material, alpha=None):
    """Static content, a child of etb; boxes (x0,y0,z0,x1,y1,z1) in etb space (centred coordinates)."""
    o = merged(name, boxes, material, collection=etb_col)
    o.parent = etb
    return o


# toploaders: standing portrait, faces toward -X, stacked front-to-back along X. Light-blue divider tube between stacks.
_TL_W, _TL_H, _TL_T, _TL_PITCH = 0.077, 0.101, 0.0035, 0.0042
_tl_z0 = ETB_WALL + 0.0005
_tl_x0 = -_e_ihx + ETB_WALL + 0.0015                       # front face of the first toploader
_tl_right = (-0.088, -0.011)                               # y range of the right stack (viewer's right = -Y)
_tl_left = (0.011, 0.088)
_tl_clear = mat("etb_toploader", (0.25, 0.4, 0.85), rough=0.1, transmission=0.8)
_tl_dark = mat("etb_toploader_stack", (0.07, 0.1, 0.32), rough=0.15)
_tl_tube = mat("etb_divider", (0.55, 0.78, 0.95), rough=0.35)
etb_part("etb_divider", [(-0.058, -0.007, _tl_z0, 0.058, 0.007, _tl_z0 + 0.104)], _tl_tube)


def _tl_boxes(y0, y1, k0, k1):
    return [(_tl_x0 + k * _TL_PITCH, y0, _tl_z0, _tl_x0 + k * _TL_PITCH + _TL_T, y1, _tl_z0 + _TL_H) for k in range(k0, k1)]


etb_part("etb_toploaders_r", _tl_boxes(*_tl_right, 0, 3), _tl_clear)
etb_part("etb_toploaders_rb", _tl_boxes(*_tl_right, 3, 14), _tl_dark)
etb_part("etb_toploaders_l", _tl_boxes(*_tl_left, 0, 2), _tl_clear)
etb_part("etb_toploaders_lb", _tl_boxes(*_tl_left, 2, 22), _tl_dark)

# the 5 real cards: front cards of the stacks, standing upright facing -X (3 in the right stack, 2 in the left)
_back_m = etb_img_mat("etb_card_back", os.path.join(ASSET_DIR, "etb151_cardback.png"), rough=0.4)
_card_slots = [((_tl_right, 0), (0.0, 0.0)), ((_tl_right, 1), (-0.002, 0.001)), ((_tl_right, 2), (0.002, -0.001)),
               ((_tl_left, 0), (0.001, 0.001)), ((_tl_left, 1), (-0.002, 0.0))]
for ci, (num, cname) in enumerate(ETB_CARDS):
    me = bpy.data.meshes.new(f"etb_card_{ci}")
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = (v.co.x * ETB_CARD_T, v.co.y * ETB_CARD_W, v.co.z * ETB_CARD_L)
    bm.normal_update()
    for f in bm.faces:
        front, back = f.normal.x < -0.5, f.normal.x > 0.5
        f.material_index = 0 if front else 1
        for lp in f.loops:
            y, z = lp.vert.co.y, lp.vert.co.z
            u = (ETB_CARD_W / 2 - y) / ETB_CARD_W if front else (y + ETB_CARD_W / 2) / ETB_CARD_W   # viewed from -X, right = -Y
            lp[uvl].uv = (u, (z + ETB_CARD_L / 2) / ETB_CARD_L)
    bm.to_mesh(me)
    bm.free()
    card = _link(f"etb_card_{ci}", me, None, collection=etb_col)
    me.materials.append(etb_img_mat(f"etb_card_front_{num}", os.path.join(ASSET_DIR, "cards151", f"{num}.png"),
                                    rough=0.3, jpeg_fill=True))
    me.materials.append(_back_m)
    card.parent = etb
    (yr, k), (oy, oz) = _card_slots[ci]
    card.location = (_tl_x0 + k * _TL_PITCH + _TL_T / 2 - 0.0004, (yr[0] + yr[1]) / 2 + oy,
                     _tl_z0 + _TL_H / 2 + oz)
    card["etb_card"] = True
    card["card_name"] = cname
    card["card_index"] = ci
    card["card_up"] = [0.0, 1.0, 0.0]        # art top edge: Blender +Z = three.js +Y
    card["card_normal"] = [-1.0, 0.0, 0.0]   # face direction: Blender -X = three.js -X

# ---- Right wall: posters, jersey, heart, boxing gloves ------------------------------------
decor = new_collection("wall_decor")
wx = W - 0.004  # just in front of the right wall


def right_poster(name, y0, y1, z0, z1, material):
    return box(name, wx - 0.006, y0, z0, wx, y1, z1, material, collection=decor)


right_poster("poster_dark_art", 3.12, 3.5, 1.45, 2.0, M["poster_dark"])
sphere("poster_dark_art_face", wx - 0.008, 3.31, 1.75, 0.09, M["poster_cream"], scale=(0.05, 1, 1.3), collection=decor)

# Jersey
merged("jersey", [(wx - 0.01, 2.6, 1.38, wx, 2.95, 1.9),          # body
                  (wx - 0.01, 2.45, 1.72, wx, 3.1, 1.9)],          # sleeves
       M["black"], collection=decor)
merged("jersey_stripes", [(wx - 0.012, 2.6, 1.38, wx - 0.01, 2.95, 1.42),
                          (wx - 0.012, 2.76, 1.5, wx - 0.01, 2.79, 1.62)], M["jersey_blue"], collection=decor)
text("jersey_text", "DOUGHERTY", 0.045, (wx - 0.013, 2.775, 1.7), FACE_RIGHT_WALL, M["white"], collection=decor)

# Heart drawing
heart_pts = []
for i in range(48):
    t = i / 48 * 2 * math.pi
    hx = 16 * math.sin(t) ** 3
    hy = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
    heart_pts.append((wx - 0.006, 2.2 - hx * 0.016, 1.68 + hy * 0.016))
_me = bpy.data.meshes.new("heart")
_me.from_pydata(heart_pts, [], [list(range(len(heart_pts)))])
heart = _link("heart_drawing", _me, M["paper"], collection=decor)
_solid = heart.modifiers.new("Solidify", "SOLIDIFY")
_solid.thickness = 0.004
text("heart_text", "PETE", 0.07, (wx - 0.009, 2.2, 1.6), FACE_RIGHT_WALL, mat("ink_purple", (0.4, 0.25, 0.6)), collection=decor)

# grentperez poster
right_poster("poster_grentperez", 1.15, 1.85, 1.45, 2.05, M["poster_cream"])
text("poster_grentperez_title", "grentperez", 0.09, (wx - 0.008, 1.5, 1.92), FACE_RIGHT_WALL, M["green"], collection=decor)
merged("poster_grentperez_art", [(wx - 0.008, 1.22, 1.55, wx - 0.006, 1.5, 1.82),
                                 (wx - 0.008, 1.55, 1.5, wx - 0.006, 1.78, 1.8)], M["green"], collection=decor)

# Bewitched poster
right_poster("poster_bewitched", 0.55, 1.12, 1.45, 2.2, mat("poster_white", (0.88, 0.88, 0.86), rough=0.8))
text("poster_bewitched_title", "BEWITCHED", 0.07, (wx - 0.008, 0.835, 2.1), FACE_RIGHT_WALL, M["blue_ink"], collection=decor)
merged("poster_bewitched_border", [(wx - 0.008, 0.58, 1.48, wx - 0.007, 0.6, 2.03),
                                   (wx - 0.008, 1.07, 1.48, wx - 0.007, 1.09, 2.03),
                                   (wx - 0.008, 0.68, 1.6, wx - 0.007, 0.99, 1.95)], M["blue_ink"], collection=decor)

# Boxing gloves (interactive) — free "Boxing Gloves" model (Zsky, CC-BY), recolored
gloves = new_collection("boxing_gloves")
glove_cuff = mat("glove_cuff", (0.05, 0.05, 0.055), rough=0.4)
for name, y, upper, lower in [("gloves_black", DRESSER_Y[0] + 1.13, M["glove_black"], glove_cuff),   # above the dresser
                              ("gloves_white", DRESSER_Y[0] + 0.67, M["glove_white"], M["glove_black"])]:
    import_asset("boxing_gloves.glb", name, (0, y, 0), fit=(None, 0.36, None),
                 rotation=Matrix.Rotation(math.radians(90), 4, "Z"),       # fronts face the wall (+X)
                 align={"xmax": W - 0.005, "zcenter": 1.12},
                 part_rotations={"LBoxingGloves1": math.radians(90), "RBoxingGloves1": math.radians(-90)},
                 material_map={"Upper1LBoxingGloves1": upper, "Upper1RBoxingGloves1": upper,
                               "Lower1LBoxingGloves1": lower, "Lower1RBoxingGloves1": lower},
                 collection=gloves)

# ---- Far wall: Chainsaw Man poster -------------------------------------------------
box("poster_chainsaw_man", 1.48, D - 0.006, 1.35, 1.88, D, 1.95, M["poster_dark"], collection=decor)
text("poster_chainsaw_man_title", "CHAINSAW\nMAN", 0.06, (1.68, D - 0.008, 1.47), FACE_FAR_WALL, M["csm_red"], collection=decor)
sphere("poster_chainsaw_man_art", 1.68, D - 0.008, 1.75, 0.1, M["white"], scale=(1, 0.05, 1), collection=decor)

# ---- Left wall: papers taped above the desk ------------------------------------------
papers = []
for col, y in enumerate([0.35 + i * 0.27 for i in range(9)]):
    for row, z in enumerate((1.15, 1.47, 1.8)):
        if (col * 7 + row * 3) % 5 == 4:
            continue
        jy, jz = ((col * 13 + row * 5) % 7 - 3) * 0.008, ((col * 3 + row * 11) % 5 - 2) * 0.01
        papers.append((0.0, y + jy, z + jz, 0.004, y + jy + 0.21, z + jz + 0.28))
merged("wall_papers", papers, M["paper"], collection=decor)


# Les Misérables poster (right wall, by the closet corner)
right_poster("poster_les_miserables", 0.08, 0.46, 1.4, 1.98, mat("poster_navy", (0.03, 0.05, 0.12), rough=0.8))
text("poster_les_miserables_title", "Les\nMisérables", 0.055, (wx - 0.008, 0.27, 1.85), FACE_RIGHT_WALL, M["white"], collection=decor)
sphere("poster_les_miserables_art", wx - 0.008, 0.27, 1.58, 0.09, M["poster_cream"], scale=(0.05, 1, 1.1), collection=decor)

# ---- Near wall (door side): mirrored sliding closet, door, caps, pictures -------------
# Tagged userData.cutaway so three.js can hide/fade it when the camera is on this side.
near = new_collection("near_wall")
CLOSET = (2.25, 3.7)       # x range of the closet opening
DOOR = (0.6, 1.4)          # x range of the door opening
OPEN_H = 2.05
wall("wall_near", (W, 0), (0, 0),
     openings=[(W - CLOSET[1], W - CLOSET[0], 0.0, OPEN_H), (W - DOOR[1], W - DOOR[0], 0.0, OPEN_H)],
     ext0=T, ext1=T, collection=near)
# wall() adds glass/blinds/daylight to every opening — not wanted for a closet and a door
for i in (0, 1):
    for part in ("glass", "blinds", "blinds_head", "daylight"):
        bpy.data.objects.remove(bpy.data.objects[f"wall_near_window_{i}_{part}"])

# Closet recess behind the wall
cx0, cx1, cdep = CLOSET[0], CLOSET[1], 0.65
merged("closet_shell", [(cx0 - 0.02, -cdep - 0.02, 0, cx1 + 0.02, -cdep, OPEN_H),       # back
                        (cx0 - 0.02, -cdep, 0, cx0, -T, OPEN_H),                         # sides
                        (cx1, -cdep, 0, cx1 + 0.02, -T, OPEN_H),
                        (cx0, -cdep, OPEN_H - 0.02, cx1, -T, OPEN_H)],                   # top
       M["trim"], collection=near)
box("closet_floor", cx0, -cdep, -0.001, cx1, -T, 0.0, M["floor"], collection=near)
box("closet_shelf", cx0, -cdep, 1.72, cx1, -T - 0.05, 1.74, M["trim"], collection=near)
cylinder("closet_rod", cx0, -0.38, 1.62, cx1 - cx0, 0.012, material=M["pine"], segments=10,
         rotation=(0, math.radians(90), 0), collection=near)
# Hanging shirts — free "T-shirt" model (Poly by Google, CC-BY), recolored and copied along the rod.
# Rotated so each shirt hangs side-on (front facing along the rod), like in a real closet.
ROD_Y, ROD_Z = -0.38, 1.62
clothes_colors = [(0.02, 0.03, 0.06), (0.05, 0.06, 0.1), (0.25, 0.25, 0.27), (0.03, 0.03, 0.03),
                  (0.35, 0.05, 0.06), (0.08, 0.08, 0.1), (0.4, 0.4, 0.42), (0.05, 0.04, 0.03)]
cloth = [mat(f"cloth_{i}", c, rough=1.0) for i, c in enumerate(clothes_colors)]
shirt_top = ROD_Z - 0.06
template = import_asset("tshirt_google.glb", "closet_shirt_0", (cx0 + 0.09, ROD_Y, 0), fit=(None, 0.44, None),
                        rotation=Matrix.Rotation(math.radians(90), 4, "Z"), align={"zmax": shirt_top},
                        recolor=[cloth[0]], collection=near)
hangers, step, x, i = [], 0.075, cx0 + 0.09, 0
while x < cx1 - 0.08:
    if i == 0:
        shirt = template
    else:
        shirt = template.copy()
        shirt.data = template.data.copy()
        shirt.name = shirt.data.name = f"closet_shirt_{i}"
        near.objects.link(shirt)
        shirt.data.materials[0] = cloth[i % len(cloth)]
        for slot in range(1, len(shirt.data.materials)):
            shirt.data.materials[slot] = cloth[i % len(cloth)]
        # some hang longer (hoodies/jackets), and they sway a little
        stretch = 1.0 + (i * 7 % 4) * 0.12
        top = Vector((cx0 + 0.09, ROD_Y, shirt_top))
        shirt.data.transform(Matrix.Translation(Vector((x - (cx0 + 0.09), 0, 0)) + top)
                             @ Matrix.Rotation(((i * 5 % 7) - 3) * 0.04, 4, "Z")
                             @ Matrix.Diagonal((1, 1, stretch, 1)) @ Matrix.Translation(-top))
    hangers += [(x - 0.004, ROD_Y - 0.2, shirt_top - 0.035, x + 0.004, ROD_Y + 0.2, shirt_top - 0.025),   # shoulder bar
                (x - 0.003, ROD_Y - 0.004, shirt_top - 0.025, x + 0.003, ROD_Y + 0.004, ROD_Z + 0.03)]  # hook
    x += step
    i += 1
merged("closet_hangers", hangers, M["black"], collection=near)

# Folded shirts on the shelf — free "T-Shirts - folded" model (sirkitree, CC-BY), recolored
import_asset("tshirts_folded_sirkitree.glb", "closet_folded_shirts", (cx0 + 0.3, -0.38, 1.74), fit=(0.34, None, None),
             recolor=[cloth[2], cloth[0], cloth[6], cloth[1], M["white"], cloth[5]], collection=near)
box("closet_shelf_box", cx0 + 0.6, -0.5, 1.74, cx0 + 0.82, -0.3, 1.88, M["csm_red"], collection=near)

# Two sliding mirror doors, both pushed to the +X side (clothes visible on the -X side)
mirror = mat("mirror", (0.9, 0.9, 0.92), rough=0.02, metal=1.0)
half = (cx1 - cx0) / 2
box("closet_mirror_door", cx1 - half - 0.02, -0.045, 0.02, cx1, -0.03, OPEN_H - 0.02, mirror, collection=near)
box("closet_mirror_door_back", cx1 - half - 0.05, -0.075, 0.02, cx1 - 0.03, -0.06, OPEN_H - 0.02, mirror, collection=near)
merged("closet_mirror_frame", [(cx1 - half - 0.025, -0.05, 0.02, cx1 - half - 0.01, -0.025, OPEN_H - 0.02),
                               (cx1 - half - 0.025, -0.05, OPEN_H - 0.04, cx1, -0.025, OPEN_H - 0.02),
                               (cx0, -0.09, OPEN_H - 0.03, cx1, -0.02, OPEN_H)], M["black"], collection=near)

# Door: white panel door, origin at the hinge (x = DOOR[0]) so three.js can swing it open
door_mat = mat("door_white", (0.85, 0.84, 0.8), rough=0.5)
dw = DOOR[1] - DOOR[0] - 0.01
door = merged("door", [(0, -0.045, 0, dw, -0.005, OPEN_H - 0.01)], door_mat,
              location=(DOOR[0] + 0.005, 0, 0), collection=near)
merged("door_panels", [(0.1, -0.005, z0, dw - 0.1, 0.002, z1) for z0, z1 in ((0.15, 0.85), (1.0, 1.85))],
       door_mat, location=(DOOR[0] + 0.005, 0, 0), bevel=0.003, collection=near)
sphere("door_knob", DOOR[1] - 0.08, 0.03, 0.95, 0.03, M["chrome"], collection=near)
notes = [(0.15, 1.6), (0.32, 1.55), (0.18, 1.4), (0.4, 1.3)]
for i, (nx, nz) in enumerate(notes):
    box(f"door_note_{i}", DOOR[0] + nx, 0.002, nz, DOOR[0] + nx + 0.09, 0.004, nz + 0.07, M["paper"], collection=near)

# "HELLO my name is Pete" name-tag stickers (texture drawn as HTML and captured headless; corners in door white)
sticker_img = bpy.data.images.load(os.path.join(ASSET_DIR, "hello_my_name_is_pete.png"))
sticker_img.pack()
sticker_mat = mat("hello_sticker", (1, 1, 1), rough=0.55)
_tex = sticker_mat.node_tree.nodes.new("ShaderNodeTexImage")
_tex.image = sticker_img
sticker_mat.node_tree.links.new(_tex.outputs["Color"],
                                next(n for n in sticker_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"])
STICKER_W, STICKER_H = 0.095, 0.0686     # real name tags are ~9.5 x 6.9 cm
STICKERS = [(0.55, 1.5, 4), (0.6, 1.4, -3), (0.56, 1.3, 2),            # (x from the hinge edge, bottom z, tilt°)
            (0.08, 1.86, -6), (0.31, 1.8, 5), (0.6, 1.74, -2), (0.12, 1.14, 3), (0.4, 1.1, -5), (0.6, 1.12, 7),
            (0.2, 0.74, -3), (0.5, 0.62, 4), (0.28, 0.36, -4), (0.6, 0.24, 2), (0.07, 0.5, 6)]
for i, (nx, nz, tilt) in enumerate(STICKERS):
    cx, cz = DOOR[0] + nx + STICKER_W / 2, nz + STICKER_H / 2
    rot = Matrix.Rotation(math.radians(tilt), 3, "Y")
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    # faces into the room (+Y); seen from there, picture right is -X
    corners = [(-1, -1, (0, 0)), (1, -1, (1, 0)), (1, 1, (1, 1)), (-1, 1, (0, 1))]
    verts = [bm.verts.new(Vector((cx, 0.0045, cz)) + rot @ Vector((-sx * STICKER_W / 2, 0, sz * STICKER_H / 2)))
             for sx, sz, _ in corners]
    face = bm.faces.new(verts)
    for loop, (_, _, t) in zip(face.loops, corners):
        loop[uv].uv = t
    bm.normal_update()
    if face.normal.y < 0:
        face.normal_flip()
    me = bpy.data.meshes.new(f"door_sticker_{i}")
    bm.to_mesh(me)
    bm.free()
    _link(f"door_sticker_{i}", me, sticker_mat, collection=near)

# Caps hanging on the wall between the closet and the door (interactive)
# Free "Cap" model (J-Toastie, CC-BY): crown + brim materials recolored per cap.
# Rotated so the crown faces into the room (+Y) and the brim hangs down.
caps = new_collection("caps")
cap_rot = Matrix.Rotation(math.radians(90), 4, "Y") @ Matrix.Rotation(math.radians(-90), 4, "X")
crowns = [M["black"], mat("cap_black_logo", (0.04, 0.04, 0.04), rough=0.7),
          mat("cap_cream", (0.8, 0.75, 0.6), rough=0.8), mat("cap_navy", (0.02, 0.04, 0.12), rough=0.8)]
brims = [M["black"], M["black"], mat("cap_green_brim", (0.05, 0.25, 0.1), rough=0.8), crowns[3]]
for i, (capx, capz) in enumerate([(2.12, 1.55), (1.9, 1.55), (2.12, 1.22), (1.9, 1.22)]):
    import_asset("cap_jtoastie.glb", f"cap_{i}", (capx, 0, 0), fit=(0.2, None, None), rotation=cap_rot,
                 align={"ymin": 0.002, "zcenter": capz},
                 material_map={"gray_tone1": crowns[i], "gray_tone2": brims[i]}, collection=caps)

# Framed pictures + light switch
box("picture_pink", 1.56, 0.0, 1.72, 1.8, 0.012, 2.0, mat("frame_pink", (0.75, 0.42, 0.38), rough=0.8), collection=near)
box("picture_pink_photo", 1.62, 0.012, 1.8, 1.74, 0.014, 1.92, M["paper"], collection=near)
box("picture_green", 1.56, 0.0, 1.4, 1.8, 0.012, 1.68, mat("frame_green", (0.4, 0.62, 0.42), rough=0.8), collection=near)
box("picture_green_photo", 1.62, 0.012, 1.48, 1.74, 0.014, 1.6, M["paper"], collection=near)
box("light_switch", 1.47, 0.0, 1.1, 1.53, 0.01, 1.2, M["white"], collection=near)

# Laundry basket with the lid flipped up
basket_mat = mat("basket_white", (0.88, 0.88, 0.88), rough=0.5)
box("laundry_basket", 1.45, 0.05, 0, 1.95, 0.45, 0.62, basket_mat, bevel=0.02, collection=near)
merged("laundry_basket_holes", [(x, 0.448, z, x + 0.04, 0.452, z + 0.07)
                                for x in (1.52, 1.6, 1.68, 1.76, 1.84) for z in (0.12, 0.26, 0.4)], M["black"], collection=near)
box("laundry_basket_lid", 1.45, 0.02, 0.62, 1.95, 0.05, 0.98, basket_mat, bevel=0.01, collection=near)

for obj in near.all_objects:
    obj["cutaway"] = True
for obj in caps.all_objects:
    obj["cutaway"] = True


# More papers on the left wall near the window
merged("wall_papers_window", [(0.0, 3.2, 1.25, 0.004, 3.41, 1.53), (0.0, 3.5, 1.3, 0.004, 3.71, 1.58),
                              (0.0, 3.3, 1.62, 0.004, 3.51, 1.9)], M["paper"], collection=decor)

# Smoke detector above the door (no ceiling in the diorama, so it sits on the near wall)
cylinder("smoke_detector", 1.0, 0.0, 2.35, 0.03, 0.06, material=M["white"],
         rotation=(math.radians(-90), 0, 0), collection=near)["cutaway"] = True

# Tag interactive objects (exported as glTF extras -> three.js userData.interactive)
for name in ("laptop", "laptop_display", "desk_lamp", "chair", "bed_blanket", "jersey",
             "heart_drawing", "poster_grentperez", "poster_bewitched", "poster_chainsaw_man", "poster_dark_art",
             "gloves_black", "gloves_white",
             "tv", "tv_screen", "vase", "stanley_cup", "wall_far_window_0_blinds", "wall_papers", "poster_les_miserables",
             "door", "closet_mirror_door", "cap_0", "cap_1", "cap_2", "cap_3", "laundry_basket",
             "nintendo_3ds", "nintendo_3ds_lid", "sdat_player", "sdat_lid", "etb",
             *[f"cassette_{i}" for i in range(6)]):
    bpy.data.objects[name]["interactive"] = True

# ---- Lights (Blender preview/baking only; three.js adds its own) ------------------------
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 4.0
sun.data.color = (1.0, 0.9, 0.75)
sun.rotation_euler = (math.radians(-55), 0, math.radians(20))
scene.collection.objects.link(sun)

fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
fill.data.energy = 180
fill.data.size = 3.0
fill.location = (W / 2, D / 2, H + 0.6)
scene.collection.objects.link(fill)

window_light = bpy.data.objects.new("window_light", bpy.data.lights.new("window_light", "AREA"))
window_light.data.energy = 60
window_light.data.size = 1.2
window_light.data.color = (1.0, 0.93, 0.8)
window_light.location = (0.75, D - 0.2, 1.5)
window_light.rotation_euler = (math.radians(90), 0, 0)
scene.collection.objects.link(window_light)

world = bpy.data.worlds.new("world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.05, 0.07, 1)
scene.world = world

# ---- Camera (roughly where the photo was taken, pulled back and up) ------------------------
cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
cam.location = (W * 0.5, -3.3, 4.6)
target = Vector((W / 2, D / 2 + 0.2, 0.7))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 30
scene.collection.objects.link(cam)
scene.camera = cam

# ---- Save + export ---------------------------------------------------------------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, f"{NAME}.blend"))
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT_DIR, f"{NAME}.glb"),
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_extras=True,
    export_cameras=False,
    export_lights=False,
)

for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x, scene.render.resolution_y = 1400, 1000
near.hide_render = True
caps.hide_render = True
scene.render.filepath = os.path.join(OUT_DIR, f"{NAME}_preview.png")
bpy.ops.render.render(write_still=True)

# Second preview: from the bed looking back at the door wall (far wall hidden instead)
near.hide_render = False
caps.hide_render = False
for obj in scene.objects:
    if obj.name.startswith(("wall_far", "wall_corner")) or obj.name.startswith("poster_chainsaw"):
        obj.hide_render = True
cam.location = (W * 0.5 + 0.4, D + 2.6, 3.4)
target = Vector((W * 0.5, 0.4, 1.0))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.render.filepath = os.path.join(OUT_DIR, f"{NAME}_preview_door_side.png")
bpy.ops.render.render(write_still=True)
print("DONE:", OUT_DIR)
