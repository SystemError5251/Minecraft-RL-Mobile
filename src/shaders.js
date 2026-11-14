// GLSL-Quellen. Varianten werden über #define-Zeilen erzeugt (siehe renderer.js).
export const COMMON = `
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler2DArrayShadow;
uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSunDir;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunGlow;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec4 uFog;          // Dichte, Höhenabfall, Basishöhe, Sichtweite
uniform vec4 uSkyOverride;  // rgb + an/aus (Block-Showcase)
uniform float uTime;
uniform float uExposure;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

vec3 skyColor(vec3 d) {
  if (uSkyOverride.a > 0.5) return uSkyOverride.rgb;
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyZenith, pow(h, 0.45));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunGlow * (pow(s, 6.0) * 0.22 * (1.0 - 0.6 * h) + pow(s, 64.0) * 0.45);
  return mix(c, uSkyHorizon * 0.55, smoothstep(0.0, -0.35, d.y));
}
// Höhen- und Distanznebel; die Nebelfarbe folgt dem Himmel am Horizont inkl. Sonnenstreuung
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 v = wp - uCamPos;
  float dist = length(v);
  vec3 d = v / max(dist, 1e-4);
  float b = uFog.y;
  float a = uFog.x * exp(clamp(-(uCamPos.y - uFog.z) * b, -8.0, 4.0));
  float k = d.y * b;
  float t = abs(k) < 1e-4 ? dist : (1.0 - exp(clamp(-dist * k, -20.0, 20.0))) / k;
  float f = 1.0 - exp(-a * t);
  f = max(f, smoothstep(uFog.w * 0.72, uFog.w, dist));
  vec3 fc = skyColor(normalize(vec3(d.x, 0.02 + max(d.y, 0.0) * 0.25, d.z)));
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
vec3 tonemap(vec3 c) {
  c *= uExposure;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); // ACES (Narkowicz)
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.08);                  // Sättigung
  c *= vec3(1.035, 1.0, 0.945);               // warme Farbkorrektur
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
vec3 finalize(vec3 c) {
#ifdef DIRECT
  return tonemap(c);
#else
  return c;
#endif
}
#ifdef SHADOWS
uniform sampler2DArrayShadow uShadow;
uniform mat4 uShadowMat[2];
uniform vec4 uShadowInfo; // Texelgröße, Fade
float shadowC(int c, vec3 wp) {
  vec4 s = uShadowMat[c] * vec4(wp, 1.0);
  vec3 q = s.xyz * 0.5 + 0.5;
  if (any(lessThan(q.xy, vec2(0.02))) || any(greaterThan(q.xy, vec2(0.98))) || q.z > 1.0) return -1.0;
  float a = ign(gl_FragCoord.xy) * 6.2831853;
  vec2 r = vec2(cos(a), sin(a)) * uShadowInfo.x * 1.5;
  vec2 r2 = vec2(-r.y, r.x);
  float l = float(c);
  return 0.25 * (texture(uShadow, vec4(q.xy + r, l, q.z)) + texture(uShadow, vec4(q.xy - r, l, q.z))
               + texture(uShadow, vec4(q.xy + r2, l, q.z)) + texture(uShadow, vec4(q.xy - r2, l, q.z)));
}
float shadowAt(vec3 wp, vec3 n) {
  float s = shadowC(0, wp + n * 0.06);
#if CASCADES > 1
  if (s < 0.0) s = shadowC(1, wp + n * 0.22);
#endif
  return s < 0.0 ? 1.0 : s;
}
#endif
`;

export const TERRAIN_VS = `
layout(location=0) in vec4 aPos;   // xyz lokal, Richtung
layout(location=1) in vec4 aData;  // Layer, AO, Licht, Flags
uniform mat4 uViewProj;
uniform vec3 uOrigin;
uniform float uTime;
uniform float uWind;
out vec3 vWP;
out vec3 vAoL;
flat out vec3 vInfo;
void main() {
  vec3 p = aPos.xyz + uOrigin;
  vWP = p;
  float top = floor(aPos.w / 8.0);
  if (mod(aData.w, 2.0) >= 1.0) { // Laub weht
    float t = uTime * 1.6;
    p += uWind * 0.045 * vec3(sin(t + p.x * 0.9 + p.y * 1.3), 0.6 * sin(t * 0.8 + p.z * 1.1), sin(t * 1.2 + p.z * 0.8 + p.y * 0.7));
  }
  vAoL = vec3(aData.yz / 255.0, top);
  vInfo = vec3(aPos.w - top * 8.0, aData.x, aData.w);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const TERRAIN_FS = `
in vec3 vWP;
in vec3 vAoL;
flat in vec3 vInfo;
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormal;
out vec4 o;
void main() {
  int d = int(vInfo.x + 0.5);
  float layer = vInfo.y;
  bool cut = vInfo.z >= 2.0;
  vec3 N, T, Bt; vec2 uv;
  if (d < 2) { N = vec3(d == 0 ? 1.0 : -1.0, 0.0, 0.0); T = vec3(0.0, 0.0, 1.0); Bt = vec3(0.0, -1.0, 0.0); uv = vec2(vWP.z, clamp(1.0 - vAoL.z, 0.008, 0.992)); }
  else if (d < 4) { N = vec3(0.0, d == 2 ? 1.0 : -1.0, 0.0); T = vec3(1.0, 0.0, 0.0); Bt = vec3(0.0, 0.0, 1.0); uv = vWP.xz; }
  else { N = vec3(0.0, 0.0, d == 4 ? 1.0 : -1.0); T = vec3(1.0, 0.0, 0.0); Bt = vec3(0.0, -1.0, 0.0); uv = vec2(vWP.x, clamp(1.0 - vAoL.z, 0.008, 0.992)); }
  vec3 toCam = uCamPos - vWP;
  float dist = length(toCam);
  vec3 V = toCam / dist;
#ifdef PARALLAX
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  float ps = cut ? 0.0 : 0.045 * (1.0 - smoothstep(14.0, 26.0, dist));
  if (ps > 0.0) {
    vec3 vt = vec3(dot(V, T), dot(V, Bt), max(dot(V, N), 0.25));
    const int NS = 12;
    vec2 st = -vt.xy / vt.z * ps / float(NS);
    float lh = 1.0, hh = textureLod(uNormal, vec3(uv, layer), 0.0).a, ph = hh;
    for (int i = 0; i < NS; i++) {
      if (hh >= lh) break;
      ph = hh; uv += st; lh -= 1.0 / float(NS);
      hh = textureLod(uNormal, vec3(uv, layer), 0.0).a;
    }
    float a1 = hh - lh, a0 = (lh + 1.0 / float(NS)) - ph;
    uv -= st * clamp(a1 / max(a1 + a0, 1e-4), 0.0, 1.0);
    if (d != 2 && d != 3) uv.y = clamp(uv.y, 0.008, 0.992);
  }
  vec4 alb = textureGrad(uAlbedo, vec3(uv, layer), gx, gy);
#else
  vec4 alb = texture(uAlbedo, vec3(uv, layer));
#endif
  if (cut && alb.a < 0.35) discard;
  float em = cut ? 0.0 : alb.a;
  vec3 n = N;
  float rough = 0.9;
#ifdef NORMAL_MAP
#ifdef PARALLAX
  vec4 nm = textureGrad(uNormal, vec3(uv, layer), gx, gy);
#else
  vec4 nm = texture(uNormal, vec3(uv, layer));
#endif
  vec2 nxy = nm.xy * 2.0 - 1.0;
  n = normalize(T * nxy.x + Bt * nxy.y + N * sqrt(max(1.0 - dot(nxy, nxy), 0.05)));
  rough = nm.z;
#endif
  float ao = mix(0.32, 1.0, vAoL.x);
  float sky = vAoL.y;
  float vis = smoothstep(0.4, 0.95, sky);
#ifdef SHADOWS
  if (dot(N, uLightDir) > 0.0) vis *= shadowAt(vWP, N); else vis = 0.0;
#endif
  float ndl = max(dot(n, uLightDir), 0.0);
  if (cut) ndl = ndl * 0.6 + 0.4; // Laub lässt Licht durch
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5) * (sky * sky * 0.95 + 0.025) * ao;
  vec3 col = alb.rgb * (amb + uLightColor * ndl * vis * mix(0.55, 1.0, vAoL.x));
#ifdef NORMAL_MAP
  vec3 hv = normalize(uLightDir + V);
  float gl = 1.0 - rough;
  col += uLightColor * pow(max(dot(n, hv), 0.0), mix(8.0, 160.0, gl * gl)) * gl * gl * 0.9 * vis * step(0.0, dot(N, uLightDir));
#endif
  col += alb.rgb * em * 7.0;
  o = vec4(finalize(applyFog(col, vWP)), 1.0);
}`;

export const SHADOW_VS = `
layout(location=0) in vec4 aPos;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
void main() { gl_Position = uViewProj * vec4(aPos.xyz + uOrigin, 1.0); }`;
export const SHADOW_FS = `void main() {}`;

export const TUFT_VS = `
layout(location=0) in vec3 aQuad;   // x, y, Ebene
layout(location=1) in vec4 aInst;   // Position, Höhe
layout(location=2) in vec4 aInst2;  // Layer, Zufall, Sumpf-Ton, Licht
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uWind;
uniform float uRadius;
out vec2 vUV;
out vec3 vWP;
out vec3 vBase;
flat out vec3 vI;
void main() {
  float ang = aInst2.y * 6.2831853 + aQuad.z * 1.5707963;
  float cd = distance(aInst.xyz, uCamPos);
  float fade = (1.0 - smoothstep(uRadius * 0.65, uRadius, cd)) * smoothstep(0.6, 1.5, distance(aInst.xz, uCamPos.xz)); // nicht direkt in der Kamera
  float wdt = max(1.0, aInst.w * 0.62) * 1.15;
  vec3 b = aInst.xyz;
  vec3 p = b + vec3(cos(ang), 0.0, sin(ang)) * aQuad.x * wdt;
  p.y += aQuad.y * aInst.w * fade;
  float sw = aQuad.y * aQuad.y * uWind * min(aInst.w, 1.6);
  float t = uTime;
  p.x += (sin(t * 1.9 + b.x * 0.55 + b.z * 0.3) * 0.09 + sin(t * 0.7 + b.z * 0.21) * 0.07) * sw;
  p.z += (cos(t * 1.6 + b.z * 0.6 + b.x * 0.2) * 0.08) * sw;
  vUV = vec2(aQuad.x + 0.5, 1.0 - aQuad.y);
  vWP = p; vBase = b;
  vI = vec3(aInst2.x, aInst2.z, aInst2.w);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const TUFT_FS = `
in vec2 vUV;
in vec3 vWP;
in vec3 vBase;
flat in vec3 vI;
uniform sampler2DArray uAlbedo;
out vec4 o;
void main() {
  vec4 a = texture(uAlbedo, vec3(clamp(vUV, 0.01, 0.99), vI.x));
  if (a.a < 0.5) discard;
  vec3 alb = a.rgb * mix(vec3(1.0), vec3(0.78, 0.82, 0.5), vI.y * 0.55);
  vec3 V = normalize(uCamPos - vWP);
  float vis = smoothstep(0.4, 0.95, vI.z);
#ifdef SHADOWS
  vis *= shadowAt(vBase + vec3(0.0, 0.3, 0.0), vec3(0.0, 1.0, 0.0));
#endif
  float up = max(uLightDir.y, 0.0) * 0.75 + 0.25;
  float back = pow(max(dot(-V, uLightDir), 0.0), 3.0) * 0.9; // Durchleuchten im Gegenlicht
  float sky = vI.z;
  vec3 amb = uAmbSky * (sky * sky * 0.95 + 0.025);
  float baseSh = mix(0.42, 1.0, pow(1.0 - vUV.y, 0.7));
  vec3 col = alb * (amb + uLightColor * (up * 0.7 + back * 0.5) * vis) * baseSh;
  o = vec4(finalize(applyFog(col, vWP)), 1.0);
}`;

export const WATER_VS = `
layout(location=0) in vec4 aPos;
layout(location=1) in vec4 aData;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
out vec3 vWP;
out float vSky;
flat out float vDir;
void main() {
  vec3 p = aPos.xyz + uOrigin;
  if (aData.w > 0.5) p.y -= 0.125;
  vWP = p; vDir = mod(aPos.w, 8.0); vSky = aData.z / 255.0;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const WATER_FS = `
in vec3 vWP;
in float vSky;
flat in float vDir;
uniform sampler2DArray uNormal;
uniform float uWaterLayer;
uniform vec3 uWaterColor;
#if defined(REFRACT) || defined(SSR)
uniform sampler2D uSceneCopy;
uniform sampler2D uDepthCopy;
uniform vec2 uInvRes;
uniform vec2 uNearFar;
uniform mat4 uView;
uniform mat4 uProj;
float linZ(float d) { return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - (2.0 * d - 1.0) * (uNearFar.y - uNearFar.x)); }
#endif
out vec4 o;
void main() {
  vec3 toCam = uCamPos - vWP;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  int d = int(vDir + 0.5);
  vec3 N = vec3(0.0, 1.0, 0.0);
  if (d == 2) {
#ifdef SIMPLE_WATER
    vec2 p = vWP.xz; float t = uTime;
    N = normalize(vec3(cos(p.x * 1.3 + t * 1.4) * 0.05 + cos(p.x * 0.6 + p.y * 0.9 - t) * 0.04, 1.0, cos(p.y * 1.1 + t * 1.1) * 0.05 + cos(p.y * 0.5 - p.x * 0.8 + t * 0.8) * 0.04));
#else
    vec2 n1 = texture(uNormal, vec3(vWP.xz * 0.11 + uTime * vec2(0.012, 0.021), uWaterLayer)).xy * 2.0 - 1.0;
    vec2 n2 = texture(uNormal, vec3(vWP.zx * 0.27 - uTime * vec2(0.023, 0.011), uWaterLayer)).xy * 2.0 - 1.0;
    vec2 n3 = texture(uNormal, vec3(vWP.xz * 0.61 + uTime * vec2(-0.03, 0.02), uWaterLayer)).xy * 2.0 - 1.0;
    vec2 nn = (n1 + n2 * 0.7 + n3 * 0.35) * 0.34 * mix(1.0, 0.45, smoothstep(20.0, 120.0, dist));
    N = normalize(vec3(nn.x, 1.0, nn.y));
#endif
  } else if (d < 2) N = vec3(d == 0 ? 1.0 : -1.0, 0.0, 0.0);
  else N = vec3(0.0, 0.0, d == 4 ? 1.0 : -1.0);
  if (!gl_FrontFacing) N = -N;
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);
  float vis = smoothstep(0.4, 0.95, vSky);
#ifdef SHADOWS
  vis *= shadowAt(vWP, vec3(0.0, 1.0, 0.0));
#endif
#ifdef SSR
  { // Screen-Space-Reflections: Strahl im View-Space marschieren
    vec3 vp = (uView * vec4(vWP, 1.0)).xyz;
    vec3 vr = normalize(mat3(uView) * R);
    float sl = 0.35 + 0.25 * ign(gl_FragCoord.xy);
    vec3 p = vp; vec2 huv = vec2(0.0); bool hit = false; vec3 prev = vp;
    for (int i = 0; i < 30; i++) {
      prev = p; p += vr * sl; sl *= 1.22;
      vec4 c = uProj * vec4(p, 1.0);
      if (c.w <= 0.0) break;
      vec2 suv = c.xy / c.w * 0.5 + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
      float raw = texture(uDepthCopy, suv).r;
      float sd = linZ(raw);
      if (raw < 0.99999 && -p.z > sd && -p.z - sd < 2.0 + sl * 1.5) {
        vec3 a = prev, b = p; // binäre Verfeinerung
        for (int j = 0; j < 5; j++) {
          vec3 m = (a + b) * 0.5; vec4 mc = uProj * vec4(m, 1.0); vec2 muv = mc.xy / mc.w * 0.5 + 0.5;
          if (-m.z > linZ(texture(uDepthCopy, muv).r)) b = m; else a = m;
          huv = muv;
        }
        hit = true; break;
      }
    }
    if (hit) {
      vec2 e = smoothstep(vec2(0.0), vec2(0.08), huv) * (1.0 - smoothstep(vec2(0.92), vec2(1.0), huv));
      refl = mix(refl, texture(uSceneCopy, huv).rgb, e.x * e.y);
    }
  }
#endif
  // Sonnen-Glitzer
  float rl = max(dot(R, uLightDir), 0.0);
  float sp = pow(rl, 300.0) * 12.0 + pow(rl, 48.0) * 0.9;
  refl += uLightColor * sp * vis;
  vec3 wcol = uWaterColor * (uAmbSky * 1.3 + uLightColor * 0.22 * vis);
  vec3 col; float alpha = 1.0;
#ifdef REFRACT
  vec2 suv = gl_FragCoord.xy * uInvRes;
  float zf = linZ(gl_FragCoord.z);
  float th = max(linZ(texture(uDepthCopy, suv).r) - zf, 0.0);
  vec2 ruv = suv + N.xz * 0.035 * clamp(th, 0.0, 1.0);
  float z2 = linZ(texture(uDepthCopy, ruv).r);
  if (z2 < zf) ruv = suv; else th = z2 - zf;
  vec3 under = texture(uSceneCopy, ruv).rgb;
  float k = 1.0 - exp(-th * 0.32);
  col = mix(mix(under * vec3(0.8, 0.96, 0.92), wcol, k), refl, F);
#else
  col = mix(wcol, refl, F);
  alpha = mix(0.74, 1.0, F);
#endif
  o = vec4(finalize(applyFog(col, vWP)), alpha);
}`;

export const SKY_VS = `
out vec2 vNdc;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vNdc = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;
export const SKY_FS = `
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform vec3 uSunDisc;
uniform float uNight;
out vec4 o;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec4 a = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(a.xyz / a.w - uCamPos);
  vec3 c = skyColor(d);
  if (uSkyOverride.a < 0.5) {
    float s = dot(d, uSunDir);
    c += uSunDisc * smoothstep(0.99945, 0.9998, s);
    c += vec3(0.5, 0.6, 0.8) * uNight * smoothstep(0.9996, 0.9998, -s);
    c += vec3(0.9) * uNight * step(0.9988, h3(floor(d * 190.0))) * smoothstep(0.0, 0.25, d.y);
  }
  o = vec4(finalize(c), 1.0);
}`;

export const CLOUD_VS = `
layout(location=0) in vec4 aPos; // xyz, Richtung
uniform mat4 uViewProj;
uniform vec3 uOffset;
out vec3 vWP;
flat out float vDir;
void main() {
  vec3 p = aPos.xyz + uOffset;
  vWP = p; vDir = aPos.w;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;
export const CLOUD_FS = `
in vec3 vWP;
flat in float vDir;
out vec4 o;
void main() {
  int d = int(vDir + 0.5);
  vec3 N = d == 0 ? vec3(1, 0, 0) : d == 1 ? vec3(-1, 0, 0) : d == 2 ? vec3(0, 1, 0) : d == 3 ? vec3(0, -1, 0) : d == 4 ? vec3(0, 0, 1) : vec3(0, 0, -1);
  vec3 v = vWP - uCamPos;
  float dist = length(v);
  vec3 dir = v / dist;
  float lit = 0.5 + 0.5 * max(dot(N, uLightDir), 0.0);
  if (d == 3) lit *= 0.78;
  vec3 c = 0.92 * (uAmbSky * 0.9 + uLightColor * lit * 0.72);
  c += uSunGlow * pow(max(dot(dir, uSunDir), 0.0), 10.0) * 0.35;
  c = mix(c, skyColor(dir), smoothstep(380.0, 1350.0, dist));
  o = vec4(finalize(c), 1.0);
}`;

export const QUAD_VS = `
out vec2 vUV;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Gemeinsamer Effekt-Pass in reduzierter Auflösung: RGB = Bloom, A = Lichtstrahlen
export const FX_FS = `
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform vec2 uTexel;
uniform vec2 uSunUV;
uniform float uRayStrength;
uniform float uAspect;
out vec4 o;
void main() {
  vec3 bloom = vec3(0.0);
  float rays = 0.0;
#ifdef BLOOM
  float ws = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec3 s = min(texture(uScene, vUV + vec2(float(i), float(j)) * uTexel * 2.6).rgb, vec3(24.0));
    float br = max(max(s.r, s.g), s.b);
    float w = exp(-float(i * i + j * j) * 0.32);
    bloom += s * (max(br - 1.25, 0.0) / max(br, 1e-3)) * w;
    ws += w;
  }
  bloom /= ws;
#endif
#ifdef RAYS
  if (uRayStrength > 0.001) {
    const int NS = RAY_SAMPLES;
    vec2 st = (uSunUV - vUV) / float(NS) * 0.92;
    vec2 p = vUV + st * ign(gl_FragCoord.xy);
    float w = 1.0, acc = 0.0, wsum = 0.0;
    for (int i = 0; i < NS; i++) {
      vec2 q = (p - uSunUV) * vec2(uAspect, 1.0);
      float near = 1.0 / (1.0 + dot(q, q) * 7.0);
      acc += step(0.99999, texture(uDepth, p).r) * near * w;
      wsum += w; w *= 0.965; p += st;
    }
    rays = acc / wsum * uRayStrength;
  }
#endif
  o = vec4(bloom, rays);
}`;

export const COMPOSITE_FS = `
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uFx;
uniform vec2 uFxTexel;
uniform vec3 uRayColor;
uniform float uBloom;
out vec4 o;
void main() {
  vec3 c = texture(uScene, vUV).rgb;
#ifdef FX
  vec2 t = uFxTexel * 1.6;
  vec4 fx = texture(uFx, vUV) * 0.25
    + (texture(uFx, vUV + vec2(t.x, 0.0)) + texture(uFx, vUV - vec2(t.x, 0.0)) + texture(uFx, vUV + vec2(0.0, t.y)) + texture(uFx, vUV - vec2(0.0, t.y))) * 0.125
    + (texture(uFx, vUV + t) + texture(uFx, vUV - t) + texture(uFx, vUV + vec2(t.x, -t.y)) + texture(uFx, vUV + vec2(-t.x, t.y))) * 0.0625;
  c += fx.rgb * uBloom + uRayColor * fx.a;
#endif
  c = tonemap(c);
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

// Figuren und Item-Drops: einfache Boxen, texturiert (Block-Items) oder einfarbig
export const ENTITY_VS = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aUVL;
layout(location=3) in vec4 aCol;
uniform mat4 uViewProj;
out vec3 vWP;
out vec3 vN;
out vec3 vUVL;
out vec4 vCol;
void main() { vWP = aPos; vN = aNrm; vUVL = aUVL; vCol = aCol; gl_Position = uViewProj * vec4(aPos, 1.0); }`;
export const ENTITY_FS = `
in vec3 vWP;
in vec3 vN;
in vec3 vUVL;
in vec4 vCol;
uniform sampler2DArray uAlbedo;
out vec4 o;
void main() {
  vec3 alb = vCol.rgb;
  if (vUVL.z >= 0.0) alb *= texture(uAlbedo, vec3(vUVL.xy, floor(vUVL.z + 0.5))).rgb;
  vec3 n = normalize(vN);
  float vis = vCol.a;
#ifdef SHADOWS
  vis *= shadowAt(vWP, n);
#endif
  float sky = mix(0.3, 1.0, vCol.a);
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5) * sky * sky + 0.02;
  vec3 base = min(alb, vec3(1.0));
  vec3 col = base * (amb + uLightColor * max(dot(n, uLightDir), 0.0) * vis) + max(alb - 1.0, 0.0) * 2.0; // Farben > 1 leuchten (Augen)
  o = vec4(finalize(applyFog(col, vWP)), 1.0);
}`;

// Regen: Tropfen als schmale Quads rund um die Kamera, komplett aus gl_VertexID erzeugt
export const RAIN_VS = `
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uTime;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  int i = gl_VertexID / 6, c = gl_VertexID - i * 6;
  float fi = float(i);
  vec3 box = vec3(26.0, 22.0, 26.0);
  vec3 o = vec3(h(fi * 1.31), h(fi * 2.73 + 1.0), h(fi * 3.97 + 2.0)) * box;
  o.y -= uTime * (24.0 + 8.0 * h(fi));
  vec3 p = uCamPos + mod(o - uCamPos, box) - box * 0.5;
  float x = (c == 1 || c == 2 || c == 4) ? 1.0 : 0.0, y = (c == 2 || c == 4 || c == 5) ? 1.0 : 0.0;
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), p - uCamPos + vec3(0.001)));
  p += side * (x - 0.5) * 0.035 + vec3(0.0, y * 0.8, 0.0);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;
export const RAIN_FS = `
uniform float uRain;
out vec4 o;
void main() { o = vec4(finalize(uAmbSky * 1.6 + 0.1), 0.38 * uRain); }`;
