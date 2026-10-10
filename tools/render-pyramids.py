# Renders every game piece to an RGBA PNG. Run headless:
#   blender --background --python tools/render-pyramids.py -- [--out build/pyramids] [--only red-a,house-w] [--size 256]
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(arg('--out', os.path.join(ROOT, 'build', 'pyramids')))
SIZE = int(arg('--size', '128'))
ONLY = set(arg('--only', '').split(',')) - {''}
SAVE_BLEND = arg('--blend', '')
data = json.load(open(os.path.join(ROOT, 'tools', 'pieces.json')))

def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)

def material(name, color, rough=0.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    return m

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- pyramid body: 4-sided, base 1.0, height 0.9, flat peak plate ---
HB, HT, H, PT = 0.5, 0.15, 0.30, 0.03
bm = bmesh.new()
base = [bm.verts.new((x * HB, y * HB, 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
top = [bm.verts.new((x * HT, y * HT, H)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
bm.faces.new(base[::-1])
bm.faces.new(top)
for i in range(4):
    j = (i + 1) % 4
    bm.faces.new((base[i], base[j], top[j], top[i]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mesh = bpy.data.meshes.new('pyr')
bm.to_mesh(mesh); bm.free()
body = bpy.data.objects.new('pyramid', mesh)
scene.collection.objects.link(body)
for p in mesh.polygons: p.use_smooth = False
bev = body.modifiers.new('bevel', 'BEVEL')
bev.width = 0.012; bev.segments = 3

body_mat = material('body', srgb('#e2d9bd'), 0.38)
body.data.materials.append(body_mat)

plate = bpy.data.objects.new('plate', None)
pm = bpy.data.meshes.new('plate')
pb = bmesh.new()
bmesh.ops.create_cube(pb, size=1.0)
pb.to_mesh(pm); pb.free()
plate = bpy.data.objects.new('plate', pm)
plate.scale = (HT * 2.0 + 0.02, HT * 2.0 + 0.02, PT)
plate.location = (0, 0, H + PT / 2)
scene.collection.objects.link(plate)
plate_mat = material('plate', srgb(data['body']['lite']), 0.35)
plate.data.materials.append(plate_mat)

def make_text(name, body_text, size, mat, loc, rot):
    c = bpy.data.curves.new(name, 'FONT')
    c.body = body_text; c.size = size; c.extrude = 0.02
    c.align_x = 'CENTER'; c.align_y = 'CENTER'
    o = bpy.data.objects.new(name, c)
    o.location = loc; o.rotation_euler = rot
    o.data.materials.append(mat)
    scene.collection.objects.link(o)
    return o

# front (south, -Y) face: lay the letter on the slope, seen from straight above
alpha = math.atan2(H, HB - HT)             # slope of the face from horizontal
T = 0.50                                   # fraction up the face
face_y = HB - (HB - HT) * T
nrm = Vector((0, -math.sin(alpha), math.cos(alpha)))
face_pos = Vector((0, -face_y, H * T)) + nrm * 0.012
letter = make_text('letter', 'A', 0.24, material('ink', (1, 1, 1, 1), 0.4),
                   face_pos, (alpha, 0, 0))
letter.scale = (1, 1 / math.cos(alpha), 1)   # undo foreshortening seen from above
value = make_text('value', '1', 0.16, material('inkv', srgb('#26242b'), 0.4),
                  (0, 0, H + PT + 0.003), (0, 0, 0))

# --- camera: straight down, orthographic, base fills the frame so neighbours touch ---
cam_d = bpy.data.cameras.new('cam')
cam_d.type = 'ORTHO'
cam_d.ortho_scale = 1.0
cam = bpy.data.objects.new('cam', cam_d)
cam.location = (0, 0, 5)
cam.rotation_euler = (0, 0, 0)
scene.collection.objects.link(cam)
scene.camera = cam

# --- light ---
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 2.6
sun.data.angle = math.radians(8)
sun.rotation_euler = (math.radians(50), math.radians(-5), math.radians(-35))
scene.collection.objects.link(sun)
scene.world = bpy.data.worlds.new('w')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.9, 0.9, 0.95, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.5

# --- render settings ---
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
scene.view_settings.view_transform = 'Standard'
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'

os.makedirs(OUT, exist_ok=True)
house = data['pieces'][-1]['color'] == 'house'
for p in data['pieces']:
    if ONLY and p['id'] not in ONLY:
        continue
    is_house = p['color'] == 'house'
    body_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = \
        srgb('#322f38') if is_house else srgb('#e2d9bd')
    plate_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = \
        srgb('#46424d') if is_house else srgb('#fffdf4')
    ink = srgb('#e8d5a3') if is_house else srgb(data['palette'][p['color']])
    letter.data.body = p['letter'].upper()
    letter.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = ink
    value.data.body = str(p['value'])
    value.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = \
        srgb('#e8d5a3') if is_house else srgb('#26242b')
    scene.render.filepath = os.path.join(OUT, p['id'] + '.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', p['id'])

if SAVE_BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(SAVE_BLEND))
