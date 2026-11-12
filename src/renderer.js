// WebGL2-Renderer: Schatten-Kaskaden -> Szene (HDR) -> gemeinsamer Effekt-Pass (reduzierte Auflösung) -> Komposition.
import * as S from './shaders.js';
import { mat4, ortho, lookAt, mul, transform } from './math.js';
import { CS, CH } from './worldgen.js';
import { L, LAYERS } from './texlayers.js';
import { hash2 } from './noise.js';

const CLOUD_G = 48, CLOUD_CELL = 12, CLOUD_TILE = CLOUD_G * CLOUD_CELL;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 wird nicht unterstützt');
    this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.progs = {};
    this.targets = null;
    this.quadCap = 0;
    this.quadIbo = gl.createBuffer();
    this.ensureQuads(8192);
    // Kreuz-Quads für Büschel
    this.tuftVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tuftVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, 1, 0.5, 0, 1, 0.5, 1, 1, -0.5, 1, 1]), gl.STATIC_DRAW);
    this.tuftIbo = gl.createBuffer();
    this.emptyVao = gl.createVertexArray();
    this.buildClouds();
    this.shadowMats = [mat4(), mat4()];
    this.shadowMatArr = new Float32Array(32);
    this.frameNo = 0;
    this.stats = { chunks: 0, tris: 0 };
  }

  ensureQuads(n) {
    if (n <= this.quadCap) return;
    const gl = this.gl;
    let cap = Math.max(8192, this.quadCap);
    while (cap < n) cap *= 2;
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.quadCap = cap;
  }

  setTextures(res, buf) {
    const gl = this.gl, n = LAYERS.length, sz = n * res * res * 4;
    const bytes = new Uint8Array(buf);
    const mk = (old, fmt, data) => {
      if (old) gl.deleteTexture(old);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(res) + 1, fmt, res, res, n);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, res, res, n, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return t;
    };
    this.texAlbedo = mk(this.texAlbedo, gl.SRGB8_ALPHA8, bytes.subarray(0, sz));
    this.texNormal = mk(this.texNormal, gl.RGBA8, bytes.subarray(sz, sz * 2));
    this.texRes = res;
  }

  compile(defs, vs, fs, fsCommon = true) {
    const gl = this.gl, head = '#version 300 es\n' + defs.map((d) => `#define ${d}\n`).join('');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(log + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
        throw new Error('Shader-Fehler: ' + log);
      }
      return s;
    };
    const p = gl.createProgram();
    const a = sh(gl.VERTEX_SHADER, head + 'precision highp float;\n' + vs), b = sh(gl.FRAGMENT_SHADER, head + (fsCommon ? S.COMMON : 'precision highp float;\n') + fs);
    gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link-Fehler: ' + gl.getProgramInfoLog(p));
    gl.deleteShader(a); gl.deleteShader(b);
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  // q: effektive Grafikeinstellungen (siehe settings.js)
  configure(q) {
    const gl = this.gl;
    for (const k in this.progs) gl.deleteProgram(this.progs[k].p);
    this.q = q;
    const base = [];
    if (q.direct) base.push('DIRECT');
    if (q.shadows > 0) base.push('SHADOWS', 'CASCADES ' + q.shadows);
    const terr = [...base];
    if (q.normalMap) terr.push('NORMAL_MAP');
    if (q.parallax && q.normalMap) terr.push('PARALLAX');
    const wat = [...base];
    if (q.simpleWater) wat.push('SIMPLE_WATER');
    if (q.refract && !q.direct) wat.push('REFRACT');
    if (q.ssr && !q.direct) wat.push('SSR');
    const fx = [];
    if (q.bloom) fx.push('BLOOM');
    if (q.rays) fx.push('RAYS', 'RAY_SAMPLES ' + (q.raysScale >= 0.5 ? 40 : 28));
    this.useFx = !q.direct && (q.bloom || q.rays);
    this.useCopy = !q.direct && (q.refract || q.ssr);
    this.progs = {
      terrain: this.compile(terr, S.TERRAIN_VS, S.TERRAIN_FS),
      tuft: this.compile(base, S.TUFT_VS, S.TUFT_FS),
      water: this.compile(wat, S.WATER_VS, S.WATER_FS),
      sky: this.compile(base, S.SKY_VS, S.SKY_FS),
      cloud: this.compile(base, S.CLOUD_VS, S.CLOUD_FS),
      shadow: this.compile([], S.SHADOW_VS, S.SHADOW_FS, false),
    };
    if (this.useFx) this.progs.fx = this.compile(fx, S.QUAD_VS, S.FX_FS);
    if (!q.direct) this.progs.composite = this.compile(this.useFx ? ['FX'] : [], S.QUAD_VS, S.COMPOSITE_FS);
    this.targetKey = '';
  }

  ensureTargets() {
    const gl = this.gl, q = this.q, W = this.canvas.width, H = this.canvas.height;
    const key = [W, H, q.direct, this.useFx, this.useCopy, q.raysScale, q.shadows, q.shadowSize].join(',');
    if (key === this.targetKey) return;
    this.targetKey = key;
    const T = this.targets;
    if (T) { for (const t of T.tex) gl.deleteTexture(t); for (const f of T.fbo) gl.deleteFramebuffer(f); }
    const N = this.targets = { tex: [], fbo: [] };
    const tex2d = (ifmt, w, h, filter) => {
      const t = gl.createTexture(); N.tex.push(t);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const fbo = (color, depth) => {
      const f = gl.createFramebuffer(); N.fbo.push(f);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
      if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      return f;
    };
    const cf = this.hdr ? gl.RGBA16F : gl.RGBA8;
    if (!q.direct) {
      N.sceneColor = tex2d(cf, W, H, gl.LINEAR); N.sceneDepth = tex2d(gl.DEPTH_COMPONENT24, W, H, gl.NEAREST);
      N.scene = fbo(N.sceneColor, N.sceneDepth);
      if (this.useCopy) { N.copyColor = tex2d(cf, W, H, gl.LINEAR); N.copyDepth = tex2d(gl.DEPTH_COMPONENT24, W, H, gl.NEAREST); N.copy = fbo(N.copyColor, N.copyDepth); }
      if (this.useFx) {
        const s = q.rays ? q.raysScale : 0.25;
        N.fxW = Math.max(2, Math.round(W * s)); N.fxH = Math.max(2, Math.round(H * s));
        N.fxColor = tex2d(cf, N.fxW, N.fxH, gl.LINEAR); N.fx = fbo(N.fxColor, null);
      }
    }
    if (q.shadows > 0) {
      const t = gl.createTexture(); N.tex.push(t); N.shadowTex = t;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, q.shadowSize, q.shadowSize, q.shadows);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      N.shadowFbo = [];
      for (let i = 0; i < q.shadows; i++) {
        const f = gl.createFramebuffer(); N.fbo.push(f); N.shadowFbo.push(f);
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, t, 0, i);
        gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- Chunk-Daten ----
  uploadChunk(c, d) {
    const gl = this.gl;
    this.freeChunk(c);
    const mk = (verts) => {
      if (!verts.length) return null;
      const vao = gl.createVertexArray(), vbo = gl.createBuffer(), quads = verts.length / 32;
      this.ensureQuads(quads);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.UNSIGNED_BYTE, false, 8, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, false, 8, 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIbo);
      return { vao, vbo, quads };
    };
    c.opaque = mk(d.opaque); c.water = mk(d.water);
    if (d.tufts.length) {
      const vao = gl.createVertexArray(), vbo = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tuftVbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, d.tufts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.tuftIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]), gl.STATIC_DRAW);
      c.tufts = { vao, vbo, count: d.tufts.length / 8 };
    }
    gl.bindVertexArray(null);
  }
  freeChunk(c) {
    const gl = this.gl;
    for (const k of ['opaque', 'water', 'tufts']) if (c[k]) { gl.deleteVertexArray(c[k].vao); gl.deleteBuffer(c[k].vbo); c[k] = null; }
  }

  buildClouds() {
    const gl = this.gl, G = CLOUD_G, m = (a) => ((a % G) + G) % G;
    const pn = (x, y, p, s) => { // periodisches Value-Noise
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), w = (a) => ((a % p) + p) % p;
      const a = hash2(w(xi), w(yi), s), b = hash2(w(xi + 1), w(yi), s), c = hash2(w(xi), w(yi + 1), s), d = hash2(w(xi + 1), w(yi + 1), s);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    const on = new Uint8Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) on[j * G + i] = pn(i / 6, j / 6, 8, 901) * 0.62 + pn(i / 2.4, j / 2.4, 20, 902) * 0.38 > 0.585 ? 1 : 0;
    const v = [], C = CLOUD_CELL, T = 4;
    const quad = (pts, d) => { for (const p of pts) v.push(p[0], p[1], p[2], d); };
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      if (!on[j * G + i]) continue;
      const x0 = i * C, x1 = x0 + C, z0 = j * C, z1 = z0 + C;
      quad([[x0, T, z0], [x0, T, z1], [x1, T, z1], [x1, T, z0]], 2);
      quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], 3);
      if (!on[j * G + m(i + 1)]) quad([[x1, 0, z0], [x1, T, z0], [x1, T, z1], [x1, 0, z1]], 0);
      if (!on[j * G + m(i - 1)]) quad([[x0, 0, z0], [x0, 0, z1], [x0, T, z1], [x0, T, z0]], 1);
      if (!on[m(j + 1) * G + i]) quad([[x0, 0, z1], [x1, 0, z1], [x1, T, z1], [x0, T, z1]], 4);
      if (!on[m(j - 1) * G + i]) quad([[x0, 0, z0], [x0, T, z0], [x1, T, z0], [x1, 0, z0]], 5);
    }
    const quads = v.length / 16;
    this.ensureQuads(quads);
    const vao = gl.createVertexArray(), vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIbo);
    gl.bindVertexArray(null);
    this.clouds = { vao, quads };
  }

  use(prog, f) {
    const gl = this.gl, u = prog.u, e = f.env, c = f.cam;
    gl.useProgram(prog.p);
    const s3 = (n, v) => { if (u[n]) gl.uniform3f(u[n], v[0], v[1], v[2]); };
    s3('uCamPos', c.pos); s3('uLightDir', e.lightDir); s3('uLightColor', e.lightColor); s3('uSunDir', e.sunDir);
    s3('uSkyZenith', e.zenith); s3('uSkyHorizon', e.horizon); s3('uSunGlow', e.glow); s3('uAmbSky', e.ambSky); s3('uAmbGround', e.ambGround);
    if (u.uFog) gl.uniform4f(u.uFog, e.fog[0], e.fog[1], e.fog[2], e.fog[3]);
    if (u.uSkyOverride) gl.uniform4f(u.uSkyOverride, e.skyOverride[0], e.skyOverride[1], e.skyOverride[2], e.skyOverride[3]);
    if (u.uTime) gl.uniform1f(u.uTime, f.time);
    if (u.uExposure) gl.uniform1f(u.uExposure, e.exposure);
    if (u.uViewProj) gl.uniformMatrix4fv(u.uViewProj, false, c.viewProj);
    if (u.uWind) gl.uniform1f(u.uWind, this.q.wind ? 1 : 0);
    if (u.uAlbedo) gl.uniform1i(u.uAlbedo, 0);
    if (u.uNormal) gl.uniform1i(u.uNormal, 1);
    if (u.uShadow) {
      gl.uniform1i(u.uShadow, 2);
      gl.uniformMatrix4fv(u.uShadowMat, false, this.shadowMatArr);
      gl.uniform4f(u.uShadowInfo, 1 / this.q.shadowSize, 0, 0, 0);
    }
    return u;
  }

  computeShadowMatrix(i, radius, f) {
    const Ld = f.env.lightDir, c = f.cam;
    const up = Math.abs(Ld[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    const view = lookAt(mat4(), Ld, [0, 0, 0], up);
    const ctr = [c.pos[0] + c.fwd[0] * radius * 0.55, c.pos[1] + c.fwd[1] * radius * 0.3, c.pos[2] + c.fwd[2] * radius * 0.55];
    const p = transform(view, ctr[0], ctr[1], ctr[2]);
    const tx = (2 * radius) / this.q.shadowSize;
    const cx = Math.round(p[0] / tx) * tx, cy = Math.round(p[1] / tx) * tx;
    const proj = ortho(mat4(), cx - radius, cx + radius, cy - radius, cy + radius, -p[2] - 220, -p[2] + 220);
    mul(this.shadowMats[i], proj, view);
    this.shadowMatArr.set(this.shadowMats[i], i * 16);
    return { view, cx, cy, radius };
  }

  render(f) {
    const gl = this.gl, q = this.q, W = this.canvas.width, H = this.canvas.height, P = this.progs, cam = f.cam;
    this.ensureTargets();
    const T = this.targets;
    this.frameNo++;
    // sichtbare Chunks (Frustum-Culling), von vorn nach hinten
    const pl = frustumPlanes(cam.viewProj), vis = [];
    for (const c of f.chunks) {
      if (!c.ready) continue;
      const x0 = c.cx * CS, z0 = c.cz * CS;
      c.dist = Math.hypot(x0 + 8 - cam.pos[0], z0 + 8 - cam.pos[2]);
      if (aabbVisible(pl, x0, 0, z0, x0 + CS, CH, z0 + CS)) vis.push(c);
    }
    vis.sort((a, b) => a.dist - b.dist);
    let tris = 0;

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texAlbedo);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texNormal);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);

    // ---- Schatten-Kaskaden ----
    if (q.shadows > 0) {
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      gl.useProgram(P.shadow.p);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 4.0);
      gl.viewport(0, 0, q.shadowSize, q.shadowSize);
      const radii = q.shadows === 1 ? [44] : [24, 96];
      for (let i = 0; i < q.shadows; i++) {
        const info = this.computeShadowMatrix(i, radii[i], f);
        if (i === 1 && this.frameNo % 2 === 1 && !f.still) { this.shadowMatArr.set(this.prevFar || this.shadowMats[1], 16); continue; } // ferne Kaskade nur jedes 2. Bild
        if (i === 1) this.prevFar = this.shadowMats[1].slice();
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.shadowFbo[i]);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix4fv(P.shadow.u.uViewProj, false, this.shadowMats[i]);
        for (const c of f.chunks) {
          if (!c.ready || !c.opaque) continue;
          const p = transform(info.view, c.cx * CS + 8, CH / 2, c.cz * CS + 8);
          if (Math.abs(p[0] - info.cx) > info.radius + 50 || Math.abs(p[1] - info.cy) > info.radius + 50) continue;
          gl.uniform3f(P.shadow.u.uOrigin, c.cx * CS, 0, c.cz * CS);
          gl.bindVertexArray(c.opaque.vao);
          gl.drawElements(gl.TRIANGLES, c.opaque.quads * 6, gl.UNSIGNED_INT, 0);
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, T.shadowTex);
    }

    // ---- Szene ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, q.direct ? null : T.scene);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    let u = this.use(P.terrain, f);
    for (const c of vis) {
      if (!c.opaque) continue;
      gl.uniform3f(u.uOrigin, c.cx * CS, 0, c.cz * CS);
      gl.bindVertexArray(c.opaque.vao);
      gl.drawElements(gl.TRIANGLES, c.opaque.quads * 6, gl.UNSIGNED_INT, 0);
      tris += c.opaque.quads * 2;
    }
    if (q.tufts > 0) {
      gl.disable(gl.CULL_FACE);
      u = this.use(P.tuft, f);
      gl.uniform1f(u.uRadius, q.tufts);
      for (const c of vis) {
        if (!c.tufts || c.dist > q.tufts + 12) continue;
        const n = Math.floor(c.tufts.count * q.tuftDensity);
        if (!n) continue;
        gl.bindVertexArray(c.tufts.vao);
        gl.drawElementsInstanced(gl.TRIANGLES, 12, gl.UNSIGNED_BYTE, 0, n);
        tris += n * 4;
      }
      gl.enable(gl.CULL_FACE);
    }
    if (q.clouds > 0 && !f.showcase) {
      u = this.use(P.cloud, f);
      gl.bindVertexArray(this.clouds.vao);
      gl.disable(gl.CULL_FACE);
      for (let layer = 0; layer < q.clouds; layer++) {
        const drift = f.time * (layer ? 2.6 : 1.6), y = layer ? 205 : 158;
        const ox = drift + layer * 211, oz = drift * 0.25 + layer * 97;
        const bx = Math.floor((cam.pos[0] - ox) / CLOUD_TILE), bz = Math.floor((cam.pos[2] - oz) / CLOUD_TILE);
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
          const tx = (bx + i) * CLOUD_TILE + ox, tz = (bz + j) * CLOUD_TILE + oz;
          const dx = Math.max(tx - cam.pos[0], 0, cam.pos[0] - tx - CLOUD_TILE), dz = Math.max(tz - cam.pos[2], 0, cam.pos[2] - tz - CLOUD_TILE);
          if (Math.hypot(dx, dz) > 1350 || !aabbVisible(pl, tx, y, tz, tx + CLOUD_TILE, y + 4, tz + CLOUD_TILE)) continue;
          gl.uniform3f(u.uOffset, tx, y, tz);
          gl.drawElements(gl.TRIANGLES, this.clouds.quads * 6, gl.UNSIGNED_INT, 0);
        }
      }
      gl.enable(gl.CULL_FACE);
    }
    // Himmel hinter allem
    u = this.use(P.sky, f);
    gl.uniformMatrix4fv(u.uInvViewProj, false, cam.invViewProj);
    gl.uniform3f(u.uSunDisc, f.env.sunDisc[0], f.env.sunDisc[1], f.env.sunDisc[2]);
    gl.uniform1f(u.uNight, f.env.night);
    gl.depthMask(false);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    // Kopie von Farbe + Tiefe für Refraktion / SSR
    if (this.useCopy) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.scene); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.copy);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, T.copyColor);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, T.copyDepth);
    }
    // ---- Wasser ----
    u = this.use(P.water, f);
    gl.uniform1f(u.uWaterLayer, L.water);
    gl.uniform3f(u.uWaterColor, f.env.water[0], f.env.water[1], f.env.water[2]);
    if (u.uSceneCopy) gl.uniform1i(u.uSceneCopy, 3);
    if (u.uDepthCopy) gl.uniform1i(u.uDepthCopy, 4);
    if (u.uInvRes) gl.uniform2f(u.uInvRes, 1 / W, 1 / H);
    if (u.uNearFar) gl.uniform2f(u.uNearFar, cam.near, cam.far);
    if (u.uView) gl.uniformMatrix4fv(u.uView, false, cam.view);
    if (u.uProj) gl.uniformMatrix4fv(u.uProj, false, cam.proj);
    gl.disable(gl.CULL_FACE);
    if (!this.useCopy) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    for (let i = vis.length - 1; i >= 0; i--) {
      const c = vis[i];
      if (!c.water) continue;
      gl.uniform3f(u.uOrigin, c.cx * CS, 0, c.cz * CS);
      gl.bindVertexArray(c.water.vao);
      gl.drawElements(gl.TRIANGLES, c.water.quads * 6, gl.UNSIGNED_INT, 0);
      tris += c.water.quads * 2;
    }
    gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
    this.stats.chunks = vis.length; this.stats.tris = tris;
    if (q.direct) return;

    // ---- gemeinsamer Effekt-Pass (Bloom + Lichtstrahlen) in reduzierter Auflösung ----
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVao);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, T.sceneColor);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, T.sceneDepth);
    if (this.useFx) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fx);
      gl.viewport(0, 0, T.fxW, T.fxH);
      u = this.use(P.fx, f);
      gl.uniform1i(u.uScene, 5); if (u.uDepth) gl.uniform1i(u.uDepth, 6);
      if (u.uTexel) gl.uniform2f(u.uTexel, 1 / W, 1 / H);
      if (u.uSunUV) {
        const s = transform(cam.viewProj, cam.pos[0] + f.env.sunDir[0] * 1000, cam.pos[1] + f.env.sunDir[1] * 1000, cam.pos[2] + f.env.sunDir[2] * 1000);
        let str = 0, sx = 0.5, sy = 0.5;
        if (s[3] > 0 && !f.showcase) {
          sx = s[0] / s[3] * 0.5 + 0.5; sy = s[1] / s[3] * 0.5 + 0.5;
          const off = Math.max(Math.abs(s[0] / s[3]), Math.abs(s[1] / s[3]));
          str = Math.max(0, Math.min(1, (1.9 - off) / 0.8)) * f.env.rayStrength;
        }
        gl.uniform2f(u.uSunUV, sx, sy); gl.uniform1f(u.uRayStrength, str); gl.uniform1f(u.uAspect, W / H);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, T.fxColor);
    }
    // ---- Komposition: Tonemapping + Farbkorrektur ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    u = this.use(P.composite, f);
    gl.uniform1i(u.uScene, 5);
    if (u.uFx) { gl.uniform1i(u.uFx, 7); gl.uniform2f(u.uFxTexel, 1 / T.fxW, 1 / T.fxH); }
    if (u.uRayColor) gl.uniform3f(u.uRayColor, f.env.rayColor[0], f.env.rayColor[1], f.env.rayColor[2]);
    if (u.uBloom) gl.uniform1f(u.uBloom, q.bloom ? 0.55 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function frustumPlanes(m) {
  const p = [];
  for (let i = 0; i < 3; i++) for (const s of [1, -1]) p.push([m[3] + s * m[i], m[7] + s * m[4 + i], m[11] + s * m[8 + i], m[15] + s * m[12 + i]]);
  return p;
}
function aabbVisible(pl, x0, y0, z0, x1, y1, z1) {
  for (const p of pl) if (p[0] * (p[0] > 0 ? x1 : x0) + p[1] * (p[1] > 0 ? y1 : y0) + p[2] * (p[2] > 0 ? z1 : z0) + p[3] < 0) return false;
  return true;
}
