import * as THREE from '/assets/three/three.module.js';

const INK = { red: '#c4352b', blue: '#2563b0', green: '#1b8450', yellow: '#c98a0c', house: '#f3d58a' };
const AMBER = 0xffc21a;
const textures = new Map();
function texture(text, color, background = null, outline = false) {
  const key = [text, color, background, outline].join('|');
  if (textures.has(key)) return textures.get(key);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 256, 256); }
  ctx.fillStyle = color; ctx.font = 'bold 200px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (outline) { ctx.lineJoin = 'round'; ctx.lineWidth = 20; ctx.strokeStyle = '#000'; ctx.strokeText(String(text), 128, 140); }
  ctx.fillText(String(text), 128, 140);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t); return t;
}
function label(text, color, width, height, background, outline = false) {
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({
    map: texture(text, color, background, outline), transparent: true, depthWrite: false, side: THREE.DoubleSide
  }));
}
// Four-sided frustum: base ~0.93 of the square (neighbours almost touch), flat tip 0.34 wide.
const BASE_R = .66, TIP_R = .24, HEIGHT = .5, FACE = Math.SQRT1_2;
const bodyGeometry = new THREE.CylinderGeometry(TIP_R, BASE_R, HEIGHT, 4, 1);
bodyGeometry.rotateY(Math.PI / 4);
const SLOPE = Math.atan(((BASE_R - TIP_R) * FACE) / HEIGHT); // lean of a face from vertical
const plateGeometry = new THREE.BoxGeometry(.36, .03, .36);
const sharedGeometry = new Set([bodyGeometry, plateGeometry]);

// Camera presets: elevation above the board, in radians. Same distance for all, so pieces keep their size.
// close zooms in on the playable 8x8, so the lettered faces are large; table and top show the whole board.
const VIEWS = { table: { el: Math.atan2(16, 8), zoom: 1 }, top: { el: 88 * Math.PI / 180, zoom: 1 }, close: { el: 40 * Math.PI / 180, zoom: 1.3 } };
const CAM_DIST = Math.hypot(16, 8);
const wrapPi = (d) => (((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

let runwayMark;
function runwayX() {
  if (runwayMark) return runwayMark;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.strokeStyle = 'rgba(70,48,18,.62)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(120, 120); ctx.moveTo(120, 8); ctx.lineTo(8, 120); ctx.stroke();
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  runwayMark = { geometry: new THREE.PlaneGeometry(.96, .96), material: new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }) };
  return runwayMark;
}

export class PyramidBoard {
  constructor(el) {
    this.el = el; this.pieces = new Map(); this.tiles = []; this.generation = 0; this.seen = new Set();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-5.8, 5.8, 5.8, -5.8, .1, 60);
    this.viewName = 'table'; this.elev = VIEWS.table.el; this.zoomNow = 1; this.angle = 0; this.quarterNow = 0; this.cameraReady = false; this.camToken = 0;
    this.placeCamera();
    this.scene.add(new THREE.HemisphereLight(0xfff1d6, 0x3a2e24, 1.35));
    const light = new THREE.DirectionalLight(0xffe8c4, 3.4);
    light.position.set(-5, 11, 6); light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048); Object.assign(light.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
    light.shadow.bias = -.001; this.scene.add(light);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(10.75, .28, 10.75), new THREE.MeshStandardMaterial({color: 0x2b1d12, roughness:.5, metalness:.25}));
    frame.position.y = -.2; frame.receiveShadow = true; this.scene.add(frame);
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(10.3, .04, 10.3), new THREE.MeshStandardMaterial({color: 0xc9a14a, roughness:.35, metalness:.55}));
    inlay.position.y = -.05; this.scene.add(inlay);
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const outer = !r || r === 9 || !c || c === 9;
      const tile = new THREE.Mesh(new THREE.BoxGeometry(.965, .055, .965), new THREE.MeshStandardMaterial({color: outer ? 0xb59a63 : ((r+c)%2 ? 0xf0e5c9 : 0xe5d7b3), roughness:.78}));
      tile.position.set(c - 4.5, -.02, r - 4.5); tile.receiveShadow = true;
      if (outer) { const mark = runwayX(); const x = new THREE.Mesh(mark.geometry, mark.material); x.rotation.x = -Math.PI / 2; x.position.set(c - 4.5, .0125, r - 4.5); this.scene.add(x); }
      tile.userData = {r,c}; this.tiles.push(tile); this.scene.add(tile);
    }
    this.printed = new THREE.Group(); this.scene.add(this.printed);
    this.ray = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    el.replaceChildren(this.renderer.domElement); el.classList.add('live-board');
    this.renderer.domElement.setAttribute('aria-label', 'Three dimensional Crossword Pyramids board');
    this.renderer.domElement.addEventListener('click', e => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set((e.clientX-rect.left)/rect.width*2-1, -(e.clientY-rect.top)/rect.height*2+1);
      this.ray.setFromCamera(this.pointer,this.camera);
      const hit = this.ray.intersectObjects(this.tiles)[0];
      if (hit) this.opts?.onCell?.(hit.object.userData.r,hit.object.userData.c);
    });
    this.renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); this.cancel(); el.dispatchEvent(new Event('board-context-lost')); });
    this.resize = new ResizeObserver(() => {
      const w = el.clientWidth; if (!w) return;
      this.renderer.setSize(w,w,false); this.draw();
    }); this.resize.observe(el);
    this.status = document.createElement('div'); this.status.className = 'piece-inspector'; this.status.setAttribute('aria-live','polite');
    el.after(this.status);
  }
  draw() { this.renderer.render(this.scene,this.camera); }
  get quarter() { return this.quarterNow; }
  // The camera orbits; every piece and flat label turns with it so letters stay upright and facing the viewer.
  placeCamera() {
    const h = CAM_DIST * Math.cos(this.elev), y = CAM_DIST * Math.sin(this.elev);
    this.camera.position.set(Math.sin(this.angle) * h, y, Math.cos(this.angle) * h);
    this.camera.zoom = this.zoomNow; this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, .15, 0);
    for (const p of this.pieces.values()) p.rotation.y = this.angle;
    for (const l of this.printed?.children ?? []) l.rotation.z = this.angle;
  }
  moveCamera() {
    const goalEl = VIEWS[this.viewName].el, goalZoom = VIEWS[this.viewName].zoom;
    const goalAngle = this.angle + wrapPi(this.quarterNow * Math.PI / 2 - this.angle);
    const token = ++this.camToken;
    const fromEl = this.elev, fromAngle = this.angle, fromZoom = this.zoomNow;
    if (!this.cameraReady || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.elev = goalEl; this.zoomNow = goalZoom; this.angle = goalAngle; this.cameraReady = true; this.placeCamera(); this.draw(); return;
    }
    let start;
    const tick = (t) => {
      if (token !== this.camToken) return;
      start ??= t; const f = Math.min(1, (t - start) / 320), e = f * f * (3 - 2 * f);
      this.elev = fromEl + (goalEl - fromEl) * e; this.zoomNow = fromZoom + (goalZoom - fromZoom) * e; this.angle = fromAngle + (goalAngle - fromAngle) * e;
      this.placeCamera(); this.draw();
      if (f < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  // Declarative view state from the page: { view, quarter, focus }.
  configure(opts = {}) {
    let moved = !this.cameraReady;
    if (VIEWS[opts.view] && opts.view !== this.viewName) { this.viewName = opts.view; moved = true; }
    if (Number.isInteger(opts.quarter) && ((opts.quarter % 4) + 4) % 4 !== this.quarterNow) { this.quarterNow = ((opts.quarter % 4) + 4) % 4; moved = true; }
    if (moved) this.moveCamera();
    const focus = opts.focus || null;
    if (focus !== this.focus) { this.focus = focus; for (const p of this.pieces.values()) this.applyFocus(p); this.draw(); }
  }
  // "My pieces": fade other players' colours; house pieces stay solid because every word needs one.
  applyFocus(group) {
    const top = group.userData.top;
    const dim = !!this.focus && top.o !== this.focus && top.o !== 'house';
    group.traverse((o) => {
      if (!o.isMesh || o === group.userData.glow || o === group.userData.ring) return;
      const m = o.material;
      if (!m.userData.base) m.userData.base = { t: m.transparent, o: m.opacity };
      m.transparent = dim || m.userData.base.t; m.opacity = dim ? m.userData.base.o * .3 : m.userData.base.o; m.needsUpdate = true;
    });
  }
  makePiece(top, depth) {
    const group = new THREE.Group();
    const dark = top.o === 'house';
    const material = new THREE.MeshStandardMaterial({color: dark ? 0x2c2b31 : 0xf3ead3, roughness: dark ? .42 : .4, metalness: .04, flatShading: true});
    const body = new THREE.Mesh(bodyGeometry, material); body.position.y = HEIGHT / 2; body.castShadow = true; body.receiveShadow = true; group.add(body);

    // Tip plate carrying the value.
    const plate = new THREE.Mesh(plateGeometry, new THREE.MeshStandardMaterial({color: dark ? 0x4a4850 : 0xfffaf0, roughness: .35}));
    plate.position.y = HEIGHT + .012; plate.castShadow = true; group.add(plate);
    const value = label(top.v, dark ? '#f3d58a' : '#2a1d0e', .32, .32);
    value.rotation.x = -Math.PI / 2; value.position.y = HEIGHT + .03; group.add(value);

    // Letter lies flush on the front (south) face, tilted to the face's exact slope.
    const t = .42;                                   // fraction of the way up the face
    const faceHalf = BASE_R * FACE - t * (BASE_R - TIP_R) * FACE;
    const nrm = new THREE.Vector3(0, Math.sin(SLOPE), Math.cos(SLOPE));
    const glyph = label(top.l.toUpperCase(), INK[top.o], .5, .5, null, true); // owner colour, black outline
    glyph.rotation.x = -SLOPE;
    glyph.position.set(0, t * HEIGHT, faceHalf).addScaledVector(nrm, .006);
    glyph.material.polygonOffsetFactor = -2; glyph.material.polygonOffsetUnits = -2; glyph.material.polygonOffset = true;
    group.add(glyph);

    // Selection: an amber halo shell around the pyramid and a glowing ring on its square.
    const halo = new THREE.Mesh(bodyGeometry, new THREE.MeshBasicMaterial({color: AMBER, side: THREE.BackSide, transparent: true, opacity: .8}));
    halo.position.y = HEIGHT / 2; halo.scale.set(1.12, 1.1, 1.12); halo.visible = false; group.add(halo);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.5, .66, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({color: AMBER, side: THREE.DoubleSide, transparent: true, opacity: .95}));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .03; ring.visible = false; group.add(ring);

    // Stack count chip floats above the cell's front-right corner.
    if (depth > 1) {
      const badge = label('×' + depth, '#ffe3a0', .32, .24, '#2a2018');
      badge.rotation.x = -.7; badge.position.set(.3, .58, .2); group.add(badge);
    }
    group.userData = {top, depth, material, glow: halo, ring};
    this.scene.add(group); return group;
  }
  highlight(group, selected) {
    group.userData.material.emissive.setHex(selected ? 0xffa800 : 0x000000);
    group.userData.material.emissiveIntensity = selected ? .5 : 0;
    group.userData.glow.visible = group.userData.ring.visible = selected;
  }
  removePiece(piece) {
    this.scene.remove(piece); piece.traverse(o => {
      if (!o.isMesh) return;
      if (!sharedGeometry.has(o.geometry)) o.geometry.dispose();
      o.material.dispose(); // cached glyph textures stay alive for reuse
    });
  }
  sync(state, opts={}) {
    this.latest=state; this.opts=opts;
    this.configure(opts);
    if(this.gameId !== state.gameId) { this.cancel(); this.gameId=state.gameId; this.seen.clear(); }
    if(this.animating) {
      if(state.revision > this.targetRevision) this.cancel(); else return;
    }
    this.reconcile(state);
  }
  reconcile(state) {
    const wanted=new Set();
    this.printed.children.slice().forEach(o=>{this.printed.remove(o);o.geometry.dispose();o.material.dispose();});
    for(let r=0;r<state.size;r++) for(let c=0;c<state.size;c++) {
      const cell=state.cells[r][c];
      const tile=this.tiles[r*10+c];
      tile.material.emissive.setHex(this.opts?.selected?.r===r && this.opts?.selected?.c===c ? 0x9a6a00 : 0);
      if(cell.p) { const p=label(cell.p.toUpperCase(),'#49371e',.56,.56);p.rotation.x=-Math.PI/2;p.rotation.z=this.angle;p.position.set(c-4.5,.013,r-4.5);this.printed.add(p); }
      if(!cell.t)continue;
      wanted.add(cell.t.id); let piece=this.pieces.get(cell.t.id);
      if(piece && piece.userData.depth!==cell.n){this.removePiece(piece);this.pieces.delete(cell.t.id);piece=null;}
      if(!piece){piece=this.makePiece(cell.t,cell.n);this.pieces.set(cell.t.id,piece);}
      piece.visible=true;piece.scale.setScalar(1);piece.position.set(c-4.5,0,r-4.5);piece.rotation.y=this.angle;this.applyFocus(piece);
      this.highlight(piece,this.opts?.selected?.r===r && this.opts?.selected?.c===c);
    }
    for(const [id,p] of this.pieces)if(!wanted.has(id)){this.removePiece(p);this.pieces.delete(id);}
    this.displayRevision=state.revision;
    const selected=this.opts?.selected; const cell=selected && state.cells[selected.r][selected.c];
    this.status.textContent=cell?.t ? `${cell.t.l.toUpperCase()} · value ${cell.t.v} · ${cell.t.o} · stack ×${cell.n}` : selected ? `Row ${selected.r+1}, column ${selected.c+1}${cell?.p?' · printed '+cell.p.toUpperCase():''}` : 'Select a square to inspect its letter, value and stack.';
    this.draw();
  }
  cancel() { this.generation++;this.animating=false;this.draft=false; }
  resetDraft() { this.cancel(); if(this.latest)this.reconcile(this.latest); }
  tween(duration, update, generation) {
    if(matchMedia('(prefers-reduced-motion: reduce)').matches) {update(1);this.draw();return Promise.resolve();}
    return new Promise(resolve=>{let start;const tick=t=>{
      if(generation!==this.generation)return resolve();
      start??=t;const f=Math.min(1,(t-start)/duration);update(f*f*(3-2*f));this.draw();
      if(f<1)requestAnimationFrame(tick);else resolve();
    };requestAnimationFrame(tick);});
  }
  async step(step,generation) {
    if(step.kind==='printed')return;
    const p=this.pieces.get(step.pieceId);if(!p)return;
    this.highlight(p,true);
    if(step.kind==='move') {
      const start=p.position.clone();
      await this.tween(120,f=>p.position.y=start.y+f*.95,generation);
      if(generation!==this.generation)return;
      await this.tween(360,f=>{p.position.x=start.x+(step.to[1]-4.5-start.x)*f;p.position.z=start.z+(step.to[0]-4.5-start.z)*f;},generation);
      if(generation!==this.generation)return;
      await this.tween(130,f=>p.position.y=.95*(1-f)+.12*f,generation);
    } else await this.tween(160,()=>{},generation);
  }
  async draftStep(step) {
    this.animating=true;this.draft=true;this.targetRevision=this.latest.revision;
    const gen=this.generation;await this.step(step,gen);
    // Remain in draft until Submit, Undo, Cancel, or a newer server revision.
  }
  async play(event) {
    if(this.seen.has(event.actionId)||event.gameId!==this.gameId||event.revision!==this.latest?.revision+1)return;
    this.seen.add(event.actionId);if(this.seen.size>100)this.seen.delete(this.seen.values().next().value);
    this.resetDraft();this.animating=true;this.targetRevision=event.revision;
    const gen=this.generation;
    for(const step of event.presentation.steps){await this.step(step,gen);if(gen!==this.generation)return;}
    await this.tween(240,f=>{for(const id of event.presentation.captureIds){const p=this.pieces.get(id);if(p){p.position.y=.12+f*1.2;p.scale.setScalar(1-f);}}},gen);
    if(gen!==this.generation)return;
    this.animating=false;if(this.latest)this.reconcile(this.latest);
  }
  dispose() {this.cancel();this.resize.disconnect();this.status.remove();this.renderer.dispose();}
}
