// main_FOSS.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ─────────────────────────────────────────────────────────────────────────────
//  SUN POSITION CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────
class SunPosition {
    constructor(metricSunDist) {
        this.metricSunDist = metricSunDist;
        this._axis = new THREE.Vector3(0, 1, 0);

        this._cachedYear = new Date().getUTCFullYear();
        this._yearStartMs = Date.UTC(this._cachedYear, 0, 0);
        this.tst = 0;
    }

    update(targetVector) {
        const nowMs = Date.now();
        const rad = Math.PI / 180;

        const utcYear = new Date(nowMs).getUTCFullYear();
        if (utcYear !== this._cachedYear) {
            this._cachedYear = utcYear;
            this._yearStartMs = Date.UTC(utcYear, 0, 0);
        }

        const dayOfYear = Math.floor((nowMs - this._yearStartMs) / 86400000);
        const utcHours = ((nowMs / 1000) % 86400) / 3600;

        const decl = -23.44 * Math.cos((360 / 365) * (dayOfYear + 10) * rad) * rad;
        const B   = (360 / 365) * (dayOfYear - 81) * rad;
        const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

        this.tst = utcHours + eot / 60;
        const ha  = (this.tst - 12) * 15 * rad;

        targetVector.set(
            this.metricSunDist * Math.cos(decl) * Math.sin(ha),
            this.metricSunDist * Math.sin(decl),
           -this.metricSunDist * Math.cos(decl) * Math.cos(ha)
        );

        targetVector.applyAxisAngle(this._axis, -Math.PI / 2);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  FLARE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
class FlareSystem {
    constructor(flareParams) {
        this.flareScene = new THREE.Scene();
        this.flareOrthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        this.sunNDC = new THREE.Vector3();
        this.visibilityFactor = 1.0;

        const flareGeometry = new THREE.PlaneGeometry(2, 2);
        this.flareMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uSunPos:               { value: new THREE.Vector2() },
                uAspect:               { value: window.innerWidth / window.innerHeight },
                uVisibility:           { value: 1.0 },
                uStarburstBrightness:  { value: flareParams.starburstBrightness },
                uBloomBrightness:      { value: flareParams.bloomBrightness },
                uGlowBrightness:       { value: flareParams.glowBrightness },
                uStarburstFalloff:     { value: flareParams.starburstFalloff },
                uBloomFalloff:         { value: flareParams.bloomFalloff },
                uGlowTightness:        { value: flareParams.glowTightness },
                uFlareWideness:        { value: flareParams.flareWideness },
                uFlareMistiness:       { value: flareParams.flareMistiness },
                uSeed:                 { value: Math.random() * 100.0 },
            },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                varying vec2 vUv;

                uniform vec2  uSunPos;
                uniform float uAspect;
                uniform float uVisibility;
                uniform float uStarburstBrightness;
                uniform float uBloomBrightness;
                uniform float uGlowBrightness;
                uniform float uStarburstFalloff;
                uniform float uBloomFalloff;
                uniform float uGlowTightness;
                uniform float uFlareWideness;
                uniform float uFlareMistiness;
                uniform float uSeed;

                #define PI 3.14159265359

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }

                void main() {
                    vec2 pt = (vUv - 0.5) * 2.0;
                    pt.x *= uAspect;
                    vec2 sunPosCorrected = vec2(uSunPos.x * uAspect, uSunPos.y);

                    vec2 delta = pt - sunPosCorrected;
                    float dist = length(delta);

                    float dynamicGlowTightness  = uGlowTightness / max(0.1, uVisibility);
                    float dynamicBloomFalloff   = uBloomFalloff / max(0.1, uVisibility);
                    float dynamicStarburstFalloff = uStarburstFalloff / max(0.05, pow(uVisibility, 1.5));

                    float glow = exp(-dist * dist * dynamicGlowTightness);
                    float bloom = exp(-dist * dist * dynamicBloomFalloff);

                    float baseAngle = atan(sunPosCorrected.y, sunPosCorrected.x);
                    float star = 0.0;

                    for (int i = 0; i < 3; i++) {
                        float idealAngle = baseAngle + float(i) * PI / 3.0;

                        float spikeHash = hash(vec2(float(i) * 0.37, uSeed));
                        float dir = step(0.5, spikeHash) * 2.0 - 1.0;
                        float mag = mix(0.75, 1.5, fract(spikeHash * 2.0));
                        float angleOffset = dir * mag;

                        float lengthScale = mix(0.5, 1.8, fract(spikeHash * 7.13));

                        float spikeAngle = idealAngle + angleOffset;
                        vec2 spikeDir = vec2(cos(spikeAngle), sin(spikeAngle));

                        float along = dot(delta, spikeDir);
                        float perp = abs(dot(delta, vec2(-spikeDir.y, spikeDir.x)));

                        float coreWidth = 300.0 / uFlareWideness;
                        float beamWidth = 50.0 / uFlareWideness;

                        float core = exp(-perp * coreWidth) * 0.4;
                        float beam = exp(-perp * beamWidth) * uFlareMistiness;

                        float spikeContrib = (core + beam) * exp(-abs(along) * dynamicStarburstFalloff / lengthScale);
                        star += spikeContrib;
                    }
                    star = clamp(star, 0.0, 1.0);

                    float combined = bloom * uBloomBrightness
                                   + star  * uStarburstBrightness
                                   + glow  * uGlowBrightness;

                    combined *= uVisibility;

                    vec3 bloomColor = vec3(1.0, 0.95, 0.8);
                    vec3 starColor  = vec3(1.0, 0.98, 0.9);
                    vec3 glowColor  = vec3(1.0, 0.92, 0.75);
                    vec3 sunsetColor = vec3(1.0, 0.25, 0.02);

                    float sunsetMix = 1.0 - smoothstep(0.1, 0.8, uVisibility);

                    bloomColor = mix(bloomColor, sunsetColor, sunsetMix);
                    starColor  = mix(starColor, vec3(1.0, 0.5, 0.1), sunsetMix * 0.8);
                    glowColor  = mix(glowColor, sunsetColor, sunsetMix);

                    vec3 color = mix(bloomColor, starColor, clamp(star * 2.0 / (bloom + star + 0.001), 0.0, 1.0));
                    color = mix(color, glowColor, clamp(glow * 0.5, 0.0, 1.0));

                    float noise = (hash(vUv * 1000.0) - 0.5) * 0.015;
                    color += noise;

                    gl_FragColor = vec4(color * combined, combined);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.flareQuad = new THREE.Mesh(flareGeometry, this.flareMaterial);
        this.flareScene.add(this.flareQuad);
    }

    updateOcclusion(sunPosition, camera, metricSunDist, metricSunRadius, dimCurveExponent, rawSunNDC) {
        const aspect = camera.aspect;
        const fovRad = camera.fov * Math.PI / 180.0;

        const camDist = camera.position.length();
        const earthAngularRadius = Math.asin(1.0 / camDist);
        const earthScreenRadiusY = Math.tan(earthAngularRadius) / Math.tan(fovRad / 2.0);

        const sunAngularRadius = metricSunRadius / metricSunDist;
        const sunScreenRadiusY = Math.tan(sunAngularRadius) / Math.tan(fovRad / 2.0);

        this.sunNDC.copy(rawSunNDC);

        if (this.sunNDC.z > 1.0) {
            this.visibilityFactor = 0.0;
            this.flareMaterial.uniforms.uVisibility.value = this.visibilityFactor;
            return;
        }

        const Sx = this.sunNDC.x * aspect;
        const Sy = this.sunNDC.y;
        const rS = sunScreenRadiusY;
        const Ex = 0.0;
        const Ey = 0.0;
        const rE = earthScreenRadiusY;

        const dx = Sx - Ex;
        const dy = Sy - Ey;
        const d = Math.sqrt(dx * dx + dy * dy);

        if (d >= rS + rE) {
            this.visibilityFactor = 1.0;
            this.flareMaterial.uniforms.uVisibility.value = this.visibilityFactor;
            return;
        }

        if (d <= rE - rS) {
            this.visibilityFactor = 0.0;
            this.flareMaterial.uniforms.uVisibility.value = this.visibilityFactor;
            return;
        }

        const a = (rS * rS - rE * rE + d * d) / (2.0 * d);
        const aClamped = Math.max(-rS, Math.min(rS, a));
        const theta = 2.0 * Math.acos(aClamped / rS);
        const sinTheta = Math.sin(theta);
        const A_hidden = 0.5 * rS * rS * (theta - sinTheta);
        const A_total = Math.PI * rS * rS;
        const A_vis = A_total - A_hidden;
        const areaFraction = A_vis / A_total;

        let x_hidden = 0.0;
        if (theta > 0.0001) {
            x_hidden = (4.0 * rS * Math.pow(Math.sin(theta / 2.0), 3.0)) / (3.0 * (theta - sinTheta));
        }

        const dirEx = dx / d;
        const dirEy = dy / d;

        const Cx = Sx + (A_hidden * x_hidden / A_vis) * dirEx;
        const Cy = Sy + (A_hidden * x_hidden / A_vis) * dirEy;

        this.sunNDC.x = Cx / aspect;
        this.sunNDC.y = Cy;

        this.visibilityFactor = Math.pow(areaFraction, dimCurveExponent);
        this.flareMaterial.uniforms.uVisibility.value = this.visibilityFactor;
    }

    updateScreenSpace() {
        this.flareMaterial.uniforms.uSunPos.value.set(this.sunNDC.x, this.sunNDC.y);
    }

    updateAspect(aspect) {
        this.flareMaterial.uniforms.uAspect.value = aspect;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  STAR FIELD
// ─────────────────────────────────────────────────────────────────────────────
class StarField {
    constructor(starParams) {
        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uSize:           { value: starParams.starSize },
                uBaseBrightness: { value: starParams.starBaseBrightness },
                uFaintDamp:      { value: starParams.starFaintDampening },
                uColorTint:      { value: new THREE.Color(starParams.starTint) },
                uExposure:       { value: 1.0 },
            },
            vertexShader: /* glsl */`
                attribute vec3  color;
                attribute float magnitude;
                varying vec3    vColor;
                varying float   vMag;
                uniform float uSize;

                void main() {
                    vColor = color;
                    vMag   = magnitude;
                    vec4 mvPos   = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = uSize * (0.1 + pow(magnitude, 1.5)) * (4000.0 / -mvPos.z);
                    gl_Position  = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: /* glsl */`
                uniform float uBaseBrightness;
                uniform float uFaintDamp;
                uniform vec3  uColorTint;
                uniform float uExposure;
                varying vec3  vColor;
                varying float vMag;

                void main() {
                    vec2 pt = gl_PointCoord - 0.5;
                    float radiusSq = dot(pt, pt);
                    if (radiusSq > 0.25) discard;
                    float edgeAlpha = 1.0 - smoothstep(0.18, 0.25, radiusSq);
                    float brightness = pow(vMag, uFaintDamp) * uBaseBrightness;
                    gl_FragColor = vec4(
                        vColor * uColorTint,
                        brightness * uExposure * edgeAlpha
                    );
                }
            `,
            transparent: true,
            blending:    THREE.AdditiveBlending,
            depthWrite:  false,
        });

        this.points = null;
    }

    _bvToRGB(bv) {
        const t = Math.max(0, Math.min(1, (bv + 0.4) / 2.4));
        const mix = (x, y, a) => x * (1 - a) + y * a;
        const r = t < 0.3 ? mix(0.5, 1.0, t / 0.3) : 1.0;
        const g = t < 0.5 ? mix(0.7, 1.0, t / 0.5) : mix(1.0, 0.5, (t - 0.5) / 0.5);
        const b = t < 0.3 ? 1.0 : mix(1.0, 0.2, (t - 0.3) / 0.7);
        return [r, g, b];
    }

    load(url, scene) {
        new THREE.FileLoader().load(url, (text) => {
            const lines    = text.trim().split('\n');
            const startIdx = lines[0].toLowerCase().includes('mag') ? 1 : 0;
            const count    = lines.length - startIdx;

            const pos  = new Float32Array(count * 3);
            const col  = new Float32Array(count * 3);
            const mags = new Float32Array(count);
            let   valid = 0;

            for (let i = startIdx; i < lines.length; i++) {
                const p = lines[i].split(',');
                if (p.length < 5) continue;
                const [mag, ci, x, y, z] = p.map(Number);
                if ([x, y, z].some(isNaN)) continue;
                const len = Math.hypot(x, y, z);
                if (!len) continue;

                const normMag = Math.max(0, Math.min(1, 1 - (mag + 1.5) / 15));
                if (normMag < 0.15) continue;

                pos[valid*3]   = (x / len) * 4000;
                pos[valid*3+1] = (y / len) * 4000;
                pos[valid*3+2] = (z / len) * 4000;

                const [r, g, b] = this._bvToRGB(ci);
                col[valid*3] = r; col[valid*3+1] = g; col[valid*3+2] = b;

                mags[valid] = normMag;
                valid++;
            }

            this.geometry.setAttribute('position',  new THREE.BufferAttribute(pos.subarray(0, valid*3), 3));
            this.geometry.setAttribute('color',     new THREE.BufferAttribute(col.subarray(0, valid*3), 3));
            this.geometry.setAttribute('magnitude', new THREE.BufferAttribute(mags.subarray(0, valid), 1));

            const starPoints = new THREE.Points(this.geometry, this.material);
            starPoints.rotation.x = -Math.PI / 2;
            scene.add(starPoints);
            this.points = starPoints;
        });
    }

    setExposure(value) {
        this.material.uniforms.uExposure.value = value;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PLANET POSITIONS
// ─────────────────────────────────────────────────────────────────────────────
class PlanetPositions {
    constructor() {
        this._planets = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];
        this.elements = {
            mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
            venus:   [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
            earth:   [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
            mars:    [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
            jupiter: [5.20288700, -0.00011607, 0.04838624, -0.00012880, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
            saturn:  [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.94432229, 1222.49362201, 92.43194139, -0.41897216, 113.66242448, -0.28867794]
        };
    }

    _solveKepler(M, e) {
        let E = M + e * Math.sin(M);
        for (let i = 0; i < 5; i++) {
            E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        }
        return E;
    }

    _helioEclipticXYZ(elem, T) {
        const rad = Math.PI / 180;
        const a = elem[0] + elem[1] * T;
        const e = elem[2] + elem[3] * T;
        const i = (elem[4] + elem[5] * T) * rad;
        const L = (elem[6] + elem[7] * T) * rad;
        const wbar = (elem[8] + elem[9] * T) * rad;
        const Omega = (elem[10] + elem[11] * T) * rad;

        const w = wbar - Omega;
        let M = L - wbar;
        M = M % (2 * Math.PI);

        const E = this._solveKepler(M, e);

        const x_prime = a * (Math.cos(E) - e);
        const y_prime = a * Math.sqrt(1 - e * e) * Math.sin(E);

        const cw = Math.cos(w), sw = Math.sin(w);
        const cO = Math.cos(Omega), sO = Math.sin(Omega);
        const ci = Math.cos(i), si = Math.sin(i);

        const x = (cw * cO - sw * ci * sO) * x_prime + (-sw * cO - cw * ci * sO) * y_prime;
        const y = (cw * sO + sw * ci * cO) * x_prime + (-sw * sO + cw * ci * cO) * y_prime;
        const z = (sw * si) * x_prime + (cw * si) * y_prime;

        return { x, y, z };
    }

    _geoEquatorialXYZ(helio, earth, T) {
        const geoX = helio.x - earth.x;
        const geoY = helio.y - earth.y;
        const geoZ = helio.z - earth.z;

        const eps = (23.43928 - 0.0130042 * T) * Math.PI / 180;
        const cE = Math.cos(eps), sE = Math.sin(eps);

        const eqX = geoX;
        const eqY = geoY * cE - geoZ * sE;
        const eqZ = geoY * sE + geoZ * cE;

        let RA = Math.atan2(eqY, eqX);
        if (RA < 0) RA += 2 * Math.PI;

        const ra_hours = RA * 12 / Math.PI;
        const dist = Math.sqrt(eqX * eqX + eqY * eqY + eqZ * eqZ);
        const dec = Math.asin(eqZ / dist);

        return { ra_hours, dec };
    }

    _toSceneXYZ(ra_hours, dec, gmstHours) {
        const rad = Math.PI / 180;
        const ha_planet = (gmstHours - ra_hours) * 15 * rad;
        const dist = 4000;

        const x =  dist * Math.cos(dec) * Math.sin(ha_planet);
        const y =  dist * Math.sin(dec);
        const z = -dist * Math.cos(dec) * Math.cos(ha_planet);

        return { x: -z, y: y, z: x };
    }

    update(T, gmstHours, positions) {
        const earthXYZ = this._helioEclipticXYZ(this.elements.earth, T);

        this._planets.forEach((name, i) => {
            const helio = this._helioEclipticXYZ(this.elements[name], T);
            const { ra_hours, dec } = this._geoEquatorialXYZ(helio, earthXYZ, T);
            const p = this._toSceneXYZ(ra_hours, dec, gmstHours);

            positions[i*3]     = p.x;
            positions[i*3 + 1] = p.y;
            positions[i*3 + 2] = p.z;
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOON POSITION CALCULATOR
//  Simplified Meeus formulae, geocentric ecliptic → equatorial → scene XYZ.
//  Same coordinate convention as SunPosition / PlanetPositions.
// ─────────────────────────────────────────────────────────────────────────────
class MoonPosition {
    update(nowMs, gmstHours, targetVector) {
        const rad = Math.PI / 180;
        const d   = nowMs / 86400000 - 10957.5;   // days since J2000.0
        const T   = d / 36525;

        // Fundamental arguments (degrees)
        const L0 = 218.316 + 13.176396 * d;   // mean longitude
        const M  = 134.963 + 13.064993 * d;   // Moon's mean anomaly
        const F  =  93.272 + 13.229350 * d;   // argument of latitude
        const D  = 297.850 + 12.190749 * d;   // mean elongation
        const Ms = 357.529 +  0.985608 * d;   // Sun's mean anomaly

        // Geocentric ecliptic longitude
        const lon = L0
            + 6.289 * Math.sin( M          * rad)
            - 1.274 * Math.sin((2*D - M)   * rad)
            + 0.658 * Math.sin( 2*D        * rad)
            - 0.214 * Math.sin( 2*M        * rad)
            - 0.186 * Math.sin( Ms         * rad)
            - 0.114 * Math.sin( 2*F        * rad);

        // Geocentric ecliptic latitude
        const lat = 5.128 * Math.sin( F            * rad)
            + 0.280 * Math.sin((M  + F)    * rad)
            - 0.277 * Math.sin((M  - F)    * rad)
            + 0.176 * Math.sin((2*D - F)   * rad)
            - 0.055 * Math.sin((2*D - M - F) * rad);

        // Distance in Earth radii
        const distKm = 385001
            - 20905 * Math.cos( M        * rad)
            -  3699 * Math.cos((2*D - M) * rad)
            -  2956 * Math.cos( 2*D      * rad);
        const dist = distKm / 6371;

        // Ecliptic → equatorial
        const eps  = (23.43928 - 0.0130042 * T) * rad;
        const lonR = lon * rad, latR = lat * rad;
        const cx   = Math.cos(latR) * Math.cos(lonR);
        const cy   = Math.cos(eps) * Math.cos(latR) * Math.sin(lonR) - Math.sin(eps) * Math.sin(latR);
        const cz   = Math.sin(eps) * Math.cos(latR) * Math.sin(lonR) + Math.cos(eps) * Math.sin(latR);

        let RA = Math.atan2(cy, cx);
        if (RA < 0) RA += 2 * Math.PI;
        const ra_hours = RA * 12 / Math.PI;
        const dec      = Math.asin(cz);

        // → scene XYZ (same -π/2 Y-axis convention as SunPosition / PlanetPositions)
        const ha = (gmstHours - ra_hours) * 15 * rad;
        const sx =  dist * Math.cos(dec) * Math.sin(ha);
        const sy =  dist * Math.sin(dec);
        const sz = -dist * Math.cos(dec) * Math.cos(ha);
        targetVector.set(-sz, sy, sx);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CLOUD MANAGER
//  Fetches live cloud texture from clouds.matteason.co.uk every 3 hours.
//  Falls back to IndexedDB cache on failure, falls back to local clouds.jpg
//  if no cache exists yet. Retries at 5 → 15 → 30 min intervals on failure.
//  Contains modified EUMETSAT data.
// ─────────────────────────────────────────────────────────────────────────────
class CloudManager {
    constructor(material, maxAnisotropy, onUpdate = () => {}) {
        this.material     = material;
        this.maxAniso     = maxAnisotropy;
        this.onUpdate     = onUpdate;

        this.CLOUD_URL    = 'https://clouds.matteason.co.uk/images/4096x2048/clouds.jpg';
        this.DB_NAME      = 'EarthWallpaper';
        this.DB_VERSION   = 1;
        this.STORE_NAME   = 'assets';
        this.CACHE_KEY    = 'cloudData';
        this.REFRESH_MS   = 3 * 60 * 60 * 1000;            // 3 hours
        this.RETRY_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000]; // 5, 15, 30 min

        this.retryCount   = 0;
        this.retryTimer   = null;
        this.refreshTimer = null;
        this.db           = null;
        this.ownedTex     = null; // blob-derived texture we own and can dispose
    }

    async init() {
        try {
            this.db = await this._openDB();
        } catch (e) {
            console.warn('[CloudManager] IndexedDB unavailable:', e.message);
            this._fetchAndUpdate(null);
            return;
        }

        const cached = await this._readCache();

        if (cached) {
            // Show cached image immediately, no waiting
            await this._applyBlob(cached.blob);
            console.log('[CloudManager] Loaded from cache.');

            const age = Date.now() - cached.timestamp;
            if (age >= this.REFRESH_MS) {
                // Cache is stale — fetch fresh right away
                this._fetchAndUpdate(cached.lastModified);
            } else {
                // Schedule fetch for when cache actually expires
                const remaining = this.REFRESH_MS - age;
                console.log(`[CloudManager] Next update in ${Math.round(remaining / 60000)} min.`);
                this._scheduleRefresh(remaining, cached.lastModified);
            }
        } else {
            // Nothing cached yet — fetch immediately (local clouds.jpg is showing)
            console.log('[CloudManager] No cache found, fetching live cloud map...');
            this._fetchAndUpdate(null);
        }
    }

    // ── IndexedDB helpers ────────────────────────────────────────────────────

    _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            req.onupgradeneeded = e => e.target.result.createObjectStore(this.STORE_NAME);
            req.onsuccess  = e  => resolve(e.target.result);
            req.onerror    = () => reject(req.error);
        });
    }

    _dbGet(key) {
        return new Promise(resolve => {
            try {
                const req = this.db
                    .transaction(this.STORE_NAME, 'readonly')
                    .objectStore(this.STORE_NAME)
                    .get(key);
                req.onsuccess = () => resolve(req.result ?? null);
                req.onerror   = () => resolve(null);
            } catch { resolve(null); }
        });
    }

    _dbPut(key, value) {
        return new Promise(resolve => {
            try {
                const tx = this.db.transaction(this.STORE_NAME, 'readwrite');
                tx.objectStore(this.STORE_NAME).put(value, key);
                tx.oncomplete = () => resolve(true);
                tx.onerror    = () => resolve(false);
            } catch { resolve(false); }
        });
    }

    _readCache()            { return this._dbGet(this.CACHE_KEY); }
    _writeCache(blob, lm)   { return this._dbPut(this.CACHE_KEY, { blob, timestamp: Date.now(), lastModified: lm }); }

    // ── Texture application ──────────────────────────────────────────────────

    _applyBlob(blob) {
        return new Promise(resolve => {
            const url = URL.createObjectURL(blob);
            new THREE.TextureLoader().load(
                url,
                tex => {
                    tex.generateMipmaps = false;
                    tex.minFilter       = THREE.LinearFilter;
                    tex.anisotropy      = this.maxAniso;

                    // Dispose previous blob-derived texture to free GPU memory
                    if (this.ownedTex) this.ownedTex.dispose();
                    this.ownedTex = tex;

                    this.material.alphaMap    = tex;
                    this.material.needsUpdate = true;
                    this.onUpdate();

                    // Safe to revoke — image data is already decoded into the tex
                    URL.revokeObjectURL(url);
                    resolve();
                },
                undefined,
                err => {
                    console.warn('[CloudManager] Texture decode failed:', err);
                    URL.revokeObjectURL(url);
                    resolve(); // Keep existing texture, don't crash
                }
            );
        });
    }

    // ── Fetch logic ──────────────────────────────────────────────────────────

    async _fetchAndUpdate(cachedLM) {
        clearTimeout(this.retryTimer);

        try {
            // HEAD first — costs almost no data, tells us if the file changed
            const head = await fetch(this.CLOUD_URL, { method: 'HEAD' });
            if (!head.ok) throw new Error(`HEAD returned ${head.status}`);

            const serverLM = head.headers.get('Last-Modified');

            if (serverLM && serverLM === cachedLM) {
                // File hasn't changed — just refresh the stored timestamp
                // so the 3-hour clock resets from now
                const cached = await this._readCache();
                if (cached) await this._writeCache(cached.blob, serverLM);
                this.retryCount = 0;
                this._scheduleRefresh(this.REFRESH_MS, serverLM);
                console.log('[CloudManager] File unchanged, timestamp refreshed.');
                return;
            }

            // File is new or we have no Last-Modified to compare — full download
            console.log('[CloudManager] Downloading new cloud map...');
            const res = await fetch(this.CLOUD_URL);
            if (!res.ok) throw new Error(`GET returned ${res.status}`);

            const blob = await res.blob();

            // Write to IndexedDB before applying — data is safe even if apply fails
            await this._writeCache(blob, serverLM);
            await this._applyBlob(blob);

            this.retryCount = 0;
            this._scheduleRefresh(this.REFRESH_MS, serverLM);
            console.log('[CloudManager] Cloud map updated successfully.');

        } catch (e) {
            console.warn('[CloudManager] Fetch failed:', e.message);
            this._scheduleRetry(cachedLM);
        }
    }

    // ── Scheduling ───────────────────────────────────────────────────────────

    _scheduleRefresh(delay, lm) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this._fetchAndUpdate(lm), delay);
    }

    _scheduleRetry(lm) {
        const delay = this.RETRY_DELAYS[Math.min(this.retryCount, this.RETRY_DELAYS.length - 1)];
        console.log(`[CloudManager] Will retry in ${delay / 60000} min (attempt ${this.retryCount + 1}).`);
        this.retryCount++;
        this.retryTimer = setTimeout(() => this._fetchAndUpdate(lm), delay);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN APPLICATION CLASS
// ─────────────────────────────────────────────────────────────────────────────
class EarthApp {
  constructor() {
    this.scene  = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
        45, window.innerWidth / window.innerHeight, 0.1, 50000
    );

    // ── Interaction Properties ────────────────────────────────────────────────
    const FRAMING_DISTANCE = 3.8;
    this.earthFramingDistance = FRAMING_DISTANCE;
    this.activeView = 'earth';
    const explicitRole = new URLSearchParams(window.location.search).get('role');
    const isSecondaryDisplay = window.screenX !== 0 || window.screenY !== 0;
    this.displayRole = explicitRole === 'moon' || (explicitRole === null && isSecondaryDisplay) ? 1 : 0;
    this._viewTarget = new THREE.Vector3();
    
    this.isInteractive = false;
    this.isSettled = true;
    
    this.originalSpherical = new THREE.Spherical(FRAMING_DISTANCE, Math.PI / 2, 0);
    this.currentSpherical = new THREE.Spherical(FRAMING_DISTANCE, Math.PI / 2, 0);
    this.targetSpherical = new THREE.Spherical(FRAMING_DISTANCE, Math.PI / 2, 0);
    // ──────────────────────────────────────────────────────────────────────────

    // ── Dynamic Framing via IP Geolocation ────────────────────────────────────
    this.camera.position.set(0, 0, FRAMING_DISTANCE); // Fallback position
    this.camera.lookAt(0, 0, 0);
    this.originalSpherical.setFromVector3(this.camera.position);
    this.currentSpherical.copy(this.originalSpherical);
    this.targetSpherical.copy(this.originalSpherical);

    fetch('https://get.geojs.io/v1/ip/geo.json')
        .then(res => res.json())
        .then(data => {
            const lat = parseFloat(data.latitude);
            const lon = parseFloat(data.longitude);
            
            if (!isNaN(lat) && !isNaN(lon) && this.activeView === 'earth') {
                const latRad = lat * Math.PI / 180;
                const lonRad = lon * Math.PI / 180;
                const framingDir = new THREE.Vector3(
                    Math.cos(latRad) * Math.cos(lonRad),
                    Math.sin(latRad),
                   -Math.cos(latRad) * Math.sin(lonRad)
                );
                this.camera.position.copy(framingDir.multiplyScalar(FRAMING_DISTANCE));
                this.camera.lookAt(0, 0, 0);
                
                this.originalSpherical.setFromVector3(this.camera.position);
                this.currentSpherical.copy(this.originalSpherical);
                this.targetSpherical.copy(this.originalSpherical);
                this.autoTiltCenter = this.currentSpherical.phi;
                this.renderOnce();
            }
        })
        .catch(err => console.warn('[Geolocation] Failed to fetch IP location, using default framing.', err));
    // ──────────────────────────────────────────────────────────────────────────

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    document.body.appendChild(this.renderer.domElement);

    // ── Interaction Event Listeners ───────────────────────────────────────────
    // ──────────────────────────────────────────────────────────────────────────

    this.contextLost = false;

    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        this.contextLost = true;
        console.log('[WebGL] Context lost. Pausing renderer.');
    }, false);

    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
        this.contextLost = false;
        console.log('[WebGL] Context restored. Resuming renderer.');
        this.renderOnce();
    }, false);

    this.textureLoader = new THREE.TextureLoader();
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const loadCrispTexture = (path, colorSpace) => {
        const tex = this.textureLoader.load(path);
        tex.anisotropy = this.maxAnisotropy;
        if (colorSpace) tex.colorSpace = colorSpace;
        return tex;
    };

    const makeSolidTexture = (rgba, colorSpace) => {
        const texture = new THREE.DataTexture(
            new Uint8Array(rgba), 1, 1, THREE.RGBAFormat
        );
        if (colorSpace) texture.colorSpace = colorSpace;
        texture.needsUpdate = true;
        return texture;
    };
    // Both views need Earth's color and clouds. Only the Earth-focused view
    // loads the heavier bump, specular, and night detail maps.
    const useEarthDetailAssets = this.displayRole === 0;

    this.earthMap = loadCrispTexture('earth.jpg', THREE.SRGBColorSpace);
    this.bumpMap = useEarthDetailAssets
        ? loadCrispTexture('bump_map.jpg')
        : makeSolidTexture([128, 128, 128, 255]);
    this.specularMap = useEarthDetailAssets
        ? loadCrispTexture('specular.jpg')
        : makeSolidTexture([0, 0, 0, 255]);
    this.nightMap = useEarthDetailAssets
        ? loadCrispTexture('night_map.jpg')
        : makeSolidTexture([0, 0, 0, 255]);
    this.cloudsMap = loadCrispTexture('clouds.jpg');
    this.cloudsMap.generateMipmaps = false;
    this.cloudsMap.minFilter = THREE.LinearFilter;

    this.earthSystem = new THREE.Group();
    this.scene.add(this.earthSystem);

    const EARTH_RADIUS_KM = 6371;
    const SUN_DISTANCE_KM = 149597870;
    const SUN_RADIUS_KM   = 696340;

    this.METRIC_SUN_DIST   = SUN_DISTANCE_KM / EARTH_RADIUS_KM;
    this.METRIC_SUN_RADIUS = SUN_RADIUS_KM / EARTH_RADIUS_KM;

    this.sunPosition = new THREE.Vector3();
    this.sunPosCalc = new SunPosition(this.METRIC_SUN_DIST);

    this.params = {
        sunLightIntensity:     3.3,
        exposureDaytime:       0.15,
        exposureNighttime:     2.50,
        sunGlareStrength:      1.0,

        sunDiscBrightness:     25.0,

        cityMultiplier:        0.5,
        cityColor:             0xffcc80,
        nightContinentLift:    1.3,
        nightLiftColor:        0x304050,
        hazeBase:              0.06,
        hazeMax:               0.20,
        hazeColor:             0x8cb3ff,
        oceanGlintSharpness:   34,
        oceanGlintColor:       0x242424,
        cloudOpacity:          1.0,

        atmosphereThickness:   1.02,
        atmosColor:            0x4c9aff,
        atmosOpacity:          0.3,
        atmosEdgeThinness:     1.0,
        atmosFrontFog:         0.085,
        atmosBacklitCorona:    1.5,

        starSize:              1.7,
        starBaseBrightness:    8.5,
        starFaintDampening:    4,
        starTint:              0xffffff,

        planetBrightnessMultiplier: 1.0,

        starburstBrightness:   0.602,
        starburstFalloff:      8.892,
        flareWideness:         10.0,
        flareMistiness:        0.0,
        bloomBrightness:       0.096,
        bloomFalloff:          10.0,
        glowBrightness:        0.552,
        glowTightness:         11.5236,

        flareDimCurveExponent: 0.2,
        debugSpecularMode:     false,
    };

    this.flareSystem     = new FlareSystem(this.params);
    this.starField       = new StarField(this.params);
    this.planetPositions = new PlanetPositions();

    this.starField.load('stars.csv', this.scene);
    this._starCatalogQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 2, 0, 0)
    );
    this._starDriftQuaternion = new THREE.Quaternion();
    this._starDriftAxis = new THREE.Vector3(0, 1, 0);
    this.starDriftPeriod = 6 * 60 * 1000;

    this.planetGeo      = new THREE.BufferGeometry();
    this.planetPosArray = new Float32Array(5 * 3);
    const planetColArray = new Float32Array(5 * 3);
    const planetMagArray = new Float32Array(5);

    const pColors = [0xe8d5c0, 0xfff5e0, 0xffaa66, 0xf5e8d0, 0xf0e0b8];
    const pMags   = [0.75, 1.00, 0.80, 0.92, 0.78];

    pColors.forEach((hex, i) => {
        const c = new THREE.Color(hex);
        planetColArray.set([c.r, c.g, c.b], i * 3);
        planetMagArray[i] = pMags[i];
    });

    this.planetGeo.setAttribute('position',  new THREE.BufferAttribute(this.planetPosArray, 3).setUsage(THREE.DynamicDrawUsage));
    this.planetGeo.setAttribute('color',     new THREE.BufferAttribute(planetColArray, 3));
    this.planetGeo.setAttribute('magnitude', new THREE.BufferAttribute(planetMagArray, 1));

    this.planetMaterial = this.starField.material.clone();
    this.planetMaterial.uniforms = THREE.UniformsUtils.clone(this.starField.material.uniforms);
    this.planetMaterial.uniforms.uSize.value = 2.0;
    this.planetMaterial.uniforms.uBaseBrightness.value = 6.0 * this.params.planetBrightnessMultiplier;

    this.planetsMesh = new THREE.Points(this.planetGeo, this.planetMaterial);
    this.planetsMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.planetsMesh);

    // ── Moon ───────────────────────────────────────────────────────────────────
    const MOON_RADIUS_SCENE = 1737.4 / EARTH_RADIUS_KM;   // true radius, in Earth-radii units
    this.moonRadiusScene = MOON_RADIUS_SCENE;
    this.moonFramingDistance = MOON_RADIUS_SCENE * FRAMING_DISTANCE * 1.25;

    this.moonPosition = new THREE.Vector3();
    this.moonPosCalc  = new MoonPosition();

    this.moonColorMap = this.displayRole === 1
        ? loadCrispTexture('moon.jpg', THREE.SRGBColorSpace)
        : makeSolidTexture([128, 128, 128, 255], THREE.SRGBColorSpace);

    this.moonMaterial = new THREE.MeshStandardMaterial({
        map:         this.moonColorMap,
        color:       0xa4a4a4,
        emissiveMap: this.moonColorMap,
        emissive:    new THREE.Color(0xffffff),
        emissiveIntensity: 0.035,
        roughness:   1.0,   // moon is completely matte — no specular
        metalness:   0.0,
    });

    this.moon = new THREE.Mesh(
        new THREE.SphereGeometry(MOON_RADIUS_SCENE, 64, 64),
        this.moonMaterial
    );
    this.scene.add(this.moon);

    // Helpers for tidal locking (reused every frame, avoids per-frame allocation)
    this._moonForward = new THREE.Vector3(0, 0, 1);
    this._moonToEarth = new THREE.Vector3();
    this._moonLockQ   = new THREE.Quaternion();
    this._sunFromCamera = new THREE.Vector3();
    this._moonFromCamera = new THREE.Vector3();
    // ───────────────────────────────────────────────────────────────────────────

    this.customUniforms = {
        uSunPosition:    { value: this.sunPosition },
        uCityMultiplier: { value: this.params.cityMultiplier },
        uCityColor:      { value: new THREE.Color(this.params.cityColor) },
        uHazeColor:      { value: new THREE.Color(this.params.hazeColor) },
        uHazeBase:       { value: this.params.hazeBase },
        uHazeMax:        { value: this.params.hazeMax },
        uNightLift:      { value: this.params.nightContinentLift },
        uNightLiftColor: { value: new THREE.Color(this.params.nightLiftColor) },
    };

    const injectWorldVaryings = (shader) => {
        shader.vertexShader = /* glsl */`
            varying vec3 vWorldPos;
            varying vec3 vWorldNorm;
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            /* glsl */`#include <worldpos_vertex>
             vWorldPos  = (modelMatrix * vec4(transformed, 1.0)).xyz;
             vWorldNorm = normalize(mat3(modelMatrix) * normal);`
        );
    };

    const earthGeometry = new THREE.SphereGeometry(1, 128, 128);
    this.earthMaterial = new THREE.MeshPhongMaterial({
        map:               this.earthMap,
        bumpMap:           this.bumpMap,
        bumpScale:         0.008,
        specularMap:       this.specularMap,
        specular:          new THREE.Color(this.params.oceanGlintColor),
        shininess:         this.params.oceanGlintSharpness,
        emissiveMap:       this.nightMap,
        emissive:          new THREE.Color(0xffffff),
        emissiveIntensity: 1.0,
    });

    this.earthMaterial.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.customUniforms);

        injectWorldVaryings(shader);

        shader.fragmentShader = /* glsl */`
            uniform vec3  uSunPosition;
            uniform float uCityMultiplier;
            uniform vec3  uCityColor;
            uniform vec3  uHazeColor;
            uniform float uHazeBase, uHazeMax;
            uniform float uNightLift;
            uniform vec3  uNightLiftColor;
            varying vec3  vWorldPos;
            varying vec3  vWorldNorm;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            /* glsl */`
            #ifdef USE_EMISSIVEMAP
                vec4  emap     = texture2D(emissiveMap, vEmissiveMapUv);
                vec4  dmap     = texture2D(map, vEmissiveMapUv);

                vec3  lDir     = normalize(uSunPosition - vWorldPos);
                float lDot     = dot(vWorldNorm, lDir);

                float lightAmt = smoothstep(-0.1,  0.1, lDot);
                float nightAmt = smoothstep( 0.1, -0.1, lDot);

                float cityMask  = smoothstep(0.05, 0.15, emap.r);
                vec3  lights    = emap.rgb * uCityColor * nightAmt * cityMask * uCityMultiplier;

                vec3  nightLift = dmap.rgb * uNightLiftColor * uNightLift * nightAmt;

                vec3  vDir  = normalize(cameraPosition - vWorldPos);
                float fres  = 1.0 - max(0.0, dot(vWorldNorm, vDir));
                vec3  haze  = uHazeColor * mix(uHazeBase, uHazeMax, pow(fres, 3.0)) * lightAmt;

                totalEmissiveRadiance = lights + nightLift + haze;
            #endif
            `
        );
    };

    this.earth = new THREE.Mesh(earthGeometry, this.earthMaterial);
    this.earthSystem.add(this.earth);

    const cloudGeometry = new THREE.SphereGeometry(1.0005, 128, 128);
    this.cloudMaterial = new THREE.MeshPhongMaterial({
        color:       0xffffff,
        alphaMap:    this.cloudsMap,
        transparent: true,
        opacity:     this.params.cloudOpacity,
        side:        THREE.FrontSide,
        depthWrite:  false,
        shininess:   0,
    });

    this.cloudMaterial.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.customUniforms);

        injectWorldVaryings(shader);

        shader.fragmentShader = /* glsl */`
            uniform vec3  uSunPosition;
            uniform float uNightLift;
            uniform vec3  uNightLiftColor;
            varying vec3  vWorldPos;
            varying vec3  vWorldNorm;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            /* glsl */`
            #include <dithering_fragment>

            vec3 lDir = normalize(uSunPosition - vWorldPos);
            float lDot = dot(vWorldNorm, lDir);

            float nightAmt = smoothstep(0.1, -0.1, lDot);

            vec3 cloudShadow = uNightLiftColor * uNightLift * 1.5 * nightAmt;
            gl_FragColor.rgb += cloudShadow * diffuseColor.a;
            `
        );
    };

    this.clouds = new THREE.Mesh(cloudGeometry, this.cloudMaterial);
    this.earthSystem.add(this.clouds);
    this.clouds.visible = true;

    // ── Cloud Manager — live satellite cloud map, 3-hour refresh ─────────────
    // Falls back to IndexedDB cache on network failure, then to local clouds.jpg.
    // Data: contains modified EUMETSAT data via clouds.matteason.co.uk
    this.cloudManager = new CloudManager(
        this.cloudMaterial,
        this.maxAnisotropy,
        () => this.renderOnce()
    );
    this.cloudManager.init();
    
    // Keep one fixed body assigned to each display.
    this.viewSwitchInterval = 2 * 60 * 1000;

    // ─────────────────────────────────────────────────────────────────────────

    const atmosphereVertexShader = /* glsl */`
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
            vWorldPos    = (modelMatrix * vec4(position, 1.0)).xyz;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const atmosphereFragmentShader = /* glsl */`
        uniform vec3  uSunPosition;
        uniform vec3  uAtmosColor;
        uniform float uAtmosOpacity;
        uniform float uAtmosEdgeThinness;
        uniform float uAtmosFrontFog;
        uniform float uAtmosphereThickness;
        uniform float uAtmosBacklitCorona;

        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;

        void main() {
            vec3  viewDir = normalize(cameraPosition - vWorldPos);
            float dotNV   = max(0.0, dot(vWorldNormal, viewDir));

            float rSq   = uAtmosphereThickness * uAtmosphereThickness;
            float hPeak = sqrt(max(0.0, 1.0 - 1.0 / rSq));
            float optD;
            if (dotNV < hPeak) {
                float t = dotNV / max(hPeak, 1e-4);
                optD = pow(smoothstep(0.0, 1.0, t), 2.0);
            } else {
                float t = (dotNV - hPeak) / max(1.0 - hPeak, 1e-4);
                optD = mix(1.0, uAtmosFrontFog, pow(t, uAtmosEdgeThinness));
            }

            vec3  sunDir  = normalize(uSunPosition);
            float dayGlow = smoothstep(-0.2, 0.5, dot(vWorldNormal, sunDir));

            vec3  camToEarth  = normalize(-cameraPosition);
            float sunBehind   = max(0.0, dot(camToEarth, sunDir));
            float limbSunFace = max(0.0, dot(vWorldNormal, sunDir));
            float rimWeight   = pow(1.0 - dotNV, 3.0);
            float backlit     = sunBehind * limbSunFace * rimWeight * uAtmosBacklitCorona;

            float alpha = clamp((optD * dayGlow + backlit) * uAtmosOpacity, 0.0, 1.0);
            gl_FragColor  = vec4(uAtmosColor * alpha, alpha);
        }
    `;

    const atmosphereGeometry = new THREE.SphereGeometry(1.0, 64, 64);
    this.atmosphereMaterial  = new THREE.ShaderMaterial({
        vertexShader:   atmosphereVertexShader,
        fragmentShader: atmosphereFragmentShader,
        uniforms: {
            uSunPosition:         { value: this.sunPosition },
            uAtmosColor:          { value: new THREE.Color(this.params.atmosColor) },
            uAtmosOpacity:        { value: this.params.atmosOpacity },
            uAtmosEdgeThinness:   { value: this.params.atmosEdgeThinness },
            uAtmosFrontFog:       { value: this.params.atmosFrontFog },
            uAtmosphereThickness: { value: this.params.atmosphereThickness },
            uAtmosBacklitCorona:  { value: this.params.atmosBacklitCorona },
        },
        blending:    THREE.AdditiveBlending,
        side:        THREE.FrontSide,
        depthWrite:  false,
        transparent: true,
    });
    this.atmosphere = new THREE.Mesh(atmosphereGeometry, this.atmosphereMaterial);
    this.atmosphere.scale.setScalar(this.params.atmosphereThickness);
    this.scene.add(this.atmosphere);

    this.sunLight = new THREE.DirectionalLight(0xffffff, this.params.sunLightIntensity);
    this.scene.add(this.sunLight);

    this.sunGroup = new THREE.Group();
    this.scene.add(this.sunGroup);

    const SUN_QUAD_SCALE = this.METRIC_SUN_RADIUS * 2.5;
    const SUN_DISC_NORM  = this.METRIC_SUN_RADIUS / (SUN_QUAD_SCALE * 0.5);

    const sunProceduralGeo = new THREE.PlaneGeometry(1, 1);
    this.sunProceduralMat = new THREE.ShaderMaterial({
        uniforms: {
            uDiscRadius: { value: SUN_DISC_NORM },
            uBrightness: { value: this.params.sunDiscBrightness },
            uColorDisc:  { value: new THREE.Color(0xfffde7) },
            uColorInner: { value: new THREE.Color(0xffc850) },
            uColorOuter: { value: new THREE.Color(0x966414) }
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            varying vec3 vWorldPos;
            void main() {
                vUv = uv;
                vec4 wPos = modelMatrix * vec4(position, 1.0);
                vWorldPos = wPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * wPos;
            }
        `,
        fragmentShader: /* glsl */`
            varying vec2 vUv;
            varying vec3 vWorldPos;

            uniform float uDiscRadius;
            uniform float uBrightness;
            uniform vec3  uColorDisc;
            uniform vec3  uColorInner;
            uniform vec3  uColorOuter;

            void main() {
                vec3 rayDir = normalize(vWorldPos - cameraPosition);
                float b = dot(cameraPosition, rayDir);
                float c = dot(cameraPosition, cameraPosition) - 1.0;
                float h = b * b - c;

                if (h > 0.0) {
                    float t = -b - sqrt(h);
                    if (t > 0.0 && t < length(vWorldPos - cameraPosition)) discard;
                }

                vec2 pt = vUv - 0.5;
                float dist = length(pt) * 2.0;
                if (dist > 1.0) discard;

                float disc  = 1.0 - smoothstep(uDiscRadius - 0.002, uDiscRadius + 0.002, dist);
                float inner = exp(-dist * 12.0) * 0.8;
                float outer = exp(-dist * 3.0) * 0.5;

                float totalGlow = inner + outer;
                vec3 color = mix(uColorOuter, uColorInner, totalGlow);
                color = mix(color, uColorDisc, disc);

                gl_FragColor = vec4(color * uBrightness, disc + inner + outer);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    this.sunQuad = new THREE.Mesh(sunProceduralGeo, this.sunProceduralMat);
    this.sunQuad.scale.setScalar(SUN_QUAD_SCALE);
    this.sunGroup.add(this.sunQuad);

    this._rawSunNDC = new THREE.Vector3();
    this._camDirWS  = new THREE.Vector3();
    this._sunDirWS  = new THREE.Vector3();

    this.createOrbitalFeatures();

    this.renderer.autoClear = false;

    this.lastRender = 0;
    this.fpsInterval = 1000 / 2; // Default to 2 FPS when resting

    // Match both displays at a calm four-minute camera speed.
    const cameraOrbitSeconds = 4 * 60;
    this.autoRotateSpeed = (Math.PI * 2) / cameraOrbitSeconds;
    // Match screen-space motion across the side-by-side displays so the Earth
    // and Moon feel like parts of one continuous left-to-right camera move.
    this.rotationDirection = -1;
    this.autoRotateInterval = 1000 / 45;
    this.lastAutoRotate = performance.now();
    this.autoTiltCenter = this.currentSpherical.phi;
    this.autoTiltAmplitude = THREE.MathUtils.degToRad(8);
    this.autoTiltPeriod = 8 * 60 * 1000;
    this._issCameraSpherical = new THREE.Spherical();
    this._lroCameraSpherical = new THREE.Spherical();

    this.animate = (now) => {
        requestAnimationFrame(this.animate);
        
        if (this.contextLost) return;
        
        if (!now) now = performance.now();

        const assignedView = this.displayRole === 0 ? 'earth' : 'moon';
        if (assignedView !== this.activeView) {
            this.switchView(assignedView);
        }
        
        let needsContinuousRender = false;

        if (this.isInteractive) {
            this.lastAutoRotate = now;

            let diffThetaInter = this.targetSpherical.theta - this.currentSpherical.theta;
            while (diffThetaInter < -Math.PI) diffThetaInter += Math.PI * 2;
            while (diffThetaInter > Math.PI) diffThetaInter -= Math.PI * 2;

            this.currentSpherical.theta += diffThetaInter * 0.3;
            this.currentSpherical.phi += (this.targetSpherical.phi - this.currentSpherical.phi) * 0.3;
            needsContinuousRender = true;
        } 
        else if (!this.isSettled) {
            this.lastAutoRotate = now;
            this.targetSpherical.copy(this.originalSpherical);

            let diffTheta = this.targetSpherical.theta - this.currentSpherical.theta;
            while (diffTheta < -Math.PI) diffTheta += Math.PI * 2;
            while (diffTheta > Math.PI) diffTheta -= Math.PI * 2;

            let diffPhi = this.targetSpherical.phi - this.currentSpherical.phi;

            let stepTheta = diffTheta * 0.08;
            let stepPhi = diffPhi * 0.08;

            const dist = Math.sqrt(diffTheta * diffTheta + diffPhi * diffPhi);
            const currentSpeed = Math.sqrt(stepTheta * stepTheta + stepPhi * stepPhi);
            const minSpeed = 0.001;

            if (currentSpeed < minSpeed && dist > 0) {
                const actualSpeed = Math.min(minSpeed, dist);
                const scale = actualSpeed / dist;
                stepTheta = diffTheta * scale;
                stepPhi = diffPhi * scale;
            }

            this.currentSpherical.theta += stepTheta;
            this.currentSpherical.phi += stepPhi;

            if (dist < 0.001) {
                this.currentSpherical.copy(this.originalSpherical);
                this.isSettled = true;
            }
            needsContinuousRender = true;
        }
        else {
            const autoRotateElapsed = now - this.lastAutoRotate;

            if (autoRotateElapsed >= this.autoRotateInterval) {
                // Cap the time step so waking from sleep does not cause a jump.
                const deltaSeconds = Math.min(autoRotateElapsed, 250) / 1000;
                this.currentSpherical.theta += this.autoRotateSpeed * this.rotationDirection * deltaSeconds;
                const tiltPhase = (Date.now() % this.autoTiltPeriod) / this.autoTiltPeriod * Math.PI * 2;
                let tiltCenter = this.autoTiltCenter;
                if (this.displayRole === 0 && this.iss.position.lengthSq() > 0.0001) {
                    // Follow the ISS's latitude while retaining a gentle local
                    // rise and fall. The faster azimuth orbit still passes the
                    // station from near to far instead of locking onto it.
                    this._issCameraSpherical.setFromVector3(this.iss.position);
                    // Follow enough of the station's latitude to create regular
                    // encounters, but retain part of the original Earth orbit
                    // so the framing continues to explore the whole planet.
                    tiltCenter = THREE.MathUtils.lerp(
                        this.autoTiltCenter,
                        this._issCameraSpherical.phi,
                        0.65
                    );
                } else if (this.displayRole === 1 && this.lro.position.lengthSq() > 0.0001) {
                    // Apply the same partial tracking around the Moon: favor
                    // the LRO's latitude without turning the shot into a
                    // spacecraft-centered chase camera.
                    this._lroCameraSpherical.setFromVector3(this.lro.position);
                    tiltCenter = THREE.MathUtils.lerp(
                        this.autoTiltCenter,
                        this._lroCameraSpherical.phi,
                        0.65
                    );
                }
                this.currentSpherical.phi = THREE.MathUtils.clamp(
                    tiltCenter + Math.sin(tiltPhase) * this.autoTiltAmplitude,
                    THREE.MathUtils.degToRad(10),
                    THREE.MathUtils.degToRad(170)
                );
                this.targetSpherical.copy(this.currentSpherical);
                this.originalSpherical.copy(this.currentSpherical);
                this.lastAutoRotate = now;
                needsContinuousRender = true;
            }
        }

        if (needsContinuousRender) {
            this.currentSpherical.makeSafe();
            this.updateCameraFromOrbit();
        }

        const elapsed = now - this.lastRender;
        
        if (needsContinuousRender || elapsed > this.fpsInterval) {
            this.lastRender = needsContinuousRender ? now : now - (elapsed % this.fpsInterval);
            this.renderOnce();
        }
    };

    this.animate();

    // Promptly redraw after Lively or Windows resumes the web wallpaper.
    const resumeRendering = () => {
        if (this.contextLost) return;
        this.lastAutoRotate = performance.now();
        this.updateSunPosition();
        this.updateCameraFromOrbit();
        this.renderOnce();
    };

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) resumeRendering();
    });
    window.addEventListener('pageshow', resumeRendering);

    window.addEventListener('resize', () => this.onResize());
  }

  createOrbitalFeatures() {
    this.gltfLoader = new GLTFLoader();
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    // The old block-built spacecraft have been removed. These empty anchors
    // receive the supplied GLB models after they load.
    this.iss = new THREE.Group();
    this.iss.visible = false;
    this.scene.add(this.iss);
    this.issModelReady = false;
    if (this.displayRole === 0) {
        this.loadWallpaperModel('./iss_stationary.glb', this.iss, 0.12, (model) => {
            this.colorIssSolarPanels(model);
            this.issModelReady = true;
        });
    }

    this.issOrbitRadius = 1 + 420 / 6371;
    this.issOrbitPeriod = 6 * 60 * 1000;
    this.issNearApparentScale = 1.0;
    this.issFarApparentScale = 1 / 8;
    this.issInclination = THREE.MathUtils.degToRad(51.6);
    this._issPosition = new THREE.Vector3();
    this._issTangent = new THREE.Vector3();
    this._issAxis = new THREE.Vector3(1, 0, 0);
    this._issForward = new THREE.Vector3(1, 0, 0);
    this._issLiveFrom = new THREE.Vector3();
    this._issLiveTo = new THREE.Vector3();
    this.issLiveDataReady = false;
    this.issLiveSegmentStart = 0;
    this.issLiveSegmentEnd = 0;
    this.issLastFetchAttempt = 0;
    this.issFetchInterval = 15 * 1000;
    this.issFetchInFlight = false;
    this.issApiWarningLogged = false;

    // Lunar Reconnaissance Orbiter. Its model is physically smaller than the
    // ISS anchor because the Moon camera sits much closer; the resulting
    // closest on-screen size is approximately the same.
    this.lro = new THREE.Group();
    this.lro.visible = false;
    this.lroModelReady = false;
    this.moon.add(this.lro);
    if (this.displayRole === 1) {
        this.loadWallpaperModel('./lro.glb', this.lro, 0.016, () => {
            this.lroModelReady = true;
        });
    }
    this.lroVisualAltitudeOffset = 0.018;
    this.lroOrbitRadius = this.moonRadiusScene + 0.07 + this.lroVisualAltitudeOffset;
    this.lroOrbitPeriod = 5 * 60 * 1000;
    this.lroInclination = THREE.MathUtils.degToRad(90);
    this.lroNearApparentScale = 1.0;
    this.lroFarApparentScale = 1 / 8;
    this._lroPosition = new THREE.Vector3();
    this._lroTangent = new THREE.Vector3();
    this._lroAxis = new THREE.Vector3(1, 0, 0);
    this._lroForward = new THREE.Vector3(1, 0, 0);
    this._lroWorldPosition = new THREE.Vector3();
    this._lroLiveFrom = new THREE.Vector3();
    this._lroLiveTo = new THREE.Vector3();
    this._lroLiveVelocityFrom = new THREE.Vector3();
    this._lroLiveVelocityTo = new THREE.Vector3();
    this.lroLiveDataReady = false;
    this.lroLiveSegmentStart = 0;
    this.lroLiveSegmentEnd = 0;
    this.lroLastFetchAttempt = 0;
    this.lroFetchInterval = 30 * 1000;
    this.lroFetchInFlight = false;
    this.lroApiWarningLogged = false;

    // Oversized stationary Apollo display piece. Parenting it directly to the
    // Moon makes its position and rotation inherit the lunar transform exactly.
    this.lander = new THREE.Group();
    this.lander.visible = false;
    this.landerModelReady = false;
    this.moon.add(this.lander);
    this._landerSunDirection = new THREE.Vector3();
    this._landerModelUp = new THREE.Vector3(0, 1, 0);
    if (this.displayRole === 1) {
        this.loadWallpaperModel('./apollo_lunar_module.glb', this.lander, 0.008, () => {
            this.placeStationaryLander();
            this.landerModelReady = true;
        });
    }
    this.featureStartTime = Date.now();
  }

  placeStationaryLander() {
    const sunDirection = new THREE.Vector3()
        .copy(this.sunPosition).sub(this.moonPosition).normalize();
    const cameraDirection = new THREE.Vector3()
        .copy(this.camera.position).sub(this.moonPosition).normalize();
    const worldSite = sunDirection.add(cameraDirection);
    if (worldSite.lengthSq() < 0.0001) worldSite.copy(cameraDirection);
    worldSite.normalize();

    const localSite = worldSite.applyQuaternion(
        new THREE.Quaternion().copy(this.moon.quaternion).invert()
    ).normalize();
    this.lander.position.copy(localSite).multiplyScalar(this.moonRadiusScene + 0.004);
    this.lander.quaternion.setFromUnitVectors(this._landerModelUp, localSite);
    this.lander.scale.set(1, 1, 1);
    this.lander.visible = true;
  }

  buildApolloClusters(normalizedModel) {
    this._landerSunDirection.copy(this.sunPosition).sub(this.moonPosition).normalize();
    const detailedPlacements = [];
    const proxyPlacements = [];
    const glowPlacements = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    // Ten Fibonacci-distributed centers cover the entire lunar sphere evenly.
    for (let clusterIndex = 0; clusterIndex < 10; clusterIndex++) {
        const centerY = 1 - 2 * (clusterIndex + 0.5) / 10;
        const centerRadius = Math.sqrt(Math.max(0, 1 - centerY * centerY));
        const centerAngle = clusterIndex * goldenAngle;
        const clusterCenter = new THREE.Vector3()
            .set(
                Math.cos(centerAngle) * centerRadius,
                centerY,
                Math.sin(centerAngle) * centerRadius
            );

        const clusterReference = Math.abs(clusterCenter.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const clusterTangentA = new THREE.Vector3()
            .crossVectors(clusterReference, clusterCenter)
            .normalize();
        const clusterTangentB = new THREE.Vector3()
            .crossVectors(clusterCenter, clusterTangentA)
            .normalize();

        for (let copyIndex = 0; copyIndex < 12; copyIndex++) {
            const fraction = copyIndex / 11;
            const sizeScale = copyIndex === 0
                ? 1
                : 0.20 + 0.80 * Math.pow(1 - fraction, 3.2);
            // A compact three-degree footprint keeps each settlement tight.
            const radialAngle = copyIndex === 0 ? 0 : 0.055 * Math.sqrt(fraction);
            const spiralAngle = copyIndex * goldenAngle + clusterIndex * 0.6;
            const radialDirection = new THREE.Vector3()
                .copy(clusterTangentA).multiplyScalar(Math.cos(spiralAngle))
                .addScaledVector(clusterTangentB, Math.sin(spiralAngle));
            const surfaceDirection = new THREE.Vector3()
                .copy(clusterCenter).multiplyScalar(Math.cos(radialAngle))
                .addScaledVector(radialDirection, Math.sin(radialAngle))
                .normalize();

            const position = surfaceDirection.clone().multiplyScalar(
                this.moonRadiusScene + 0.004 * sizeScale
            );
            const orientation = new THREE.Quaternion().setFromUnitVectors(
                this._landerModelUp,
                surfaceDirection
            );
            const placement = new THREE.Matrix4().compose(
                position,
                orientation,
                new THREE.Vector3(sizeScale, sizeScale, sizeScale)
            );

            // Only the three or four largest members retain the complete GLB.
            // Sub-pixel copies use a one-mesh proxy instead of 157 mesh parts.
            if (sizeScale >= 0.55) detailedPlacements.push(placement);
            else proxyPlacements.push(placement);

            const worldSurfaceDirection = surfaceDirection.clone()
                .applyQuaternion(this.moon.quaternion)
                .normalize();
            if (worldSurfaceDirection.dot(this._landerSunDirection) < 0.12) {
                const glowScale = 0.35 + sizeScale * 0.65;
                glowPlacements.push(new THREE.Matrix4().compose(
                    surfaceDirection.clone().multiplyScalar(this.moonRadiusScene + 0.006),
                    orientation,
                    new THREE.Vector3(glowScale, glowScale, glowScale)
                ));
            }
        }
    }

    // Flatten the detailed GLB into one InstancedMesh per original mesh.
    this.moon.updateMatrixWorld(true);
    const inverseLanderWorld = new THREE.Matrix4().copy(this.lander.matrixWorld).invert();
    const sourceMeshes = [];
    normalizedModel.traverse((object) => {
        if (object.isMesh && !object.isSkinnedMesh) sourceMeshes.push(object);
    });

    for (const sourceMesh of sourceMeshes) {
        const sourceRelativeMatrix = new THREE.Matrix4()
            .multiplyMatrices(inverseLanderWorld, sourceMesh.matrixWorld);
        const instances = new THREE.InstancedMesh(
            sourceMesh.geometry,
            sourceMesh.material,
            detailedPlacements.length
        );
        const instanceMatrix = new THREE.Matrix4();
        for (let index = 0; index < detailedPlacements.length; index++) {
            instanceMatrix.multiplyMatrices(detailedPlacements[index], sourceRelativeMatrix);
            instances.setMatrixAt(index, instanceMatrix);
        }
        instances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        instances.instanceMatrix.needsUpdate = true;
        instances.frustumCulled = false;
        instances.renderOrder = sourceMesh.renderOrder;
        this.lander.add(instances);
    }

    // At tiny screen sizes a simple gold tetrahedron reads like the lander's
    // foil body while reducing each copy from 157 mesh parts to one instance.
    const proxyGeometry = new THREE.TetrahedronGeometry(0.0042, 0);
    proxyGeometry.scale(1, 0.72, 1);
    const proxyMaterial = new THREE.MeshStandardMaterial({
        color: 0x9b7a3c,
        emissive: 0x120b02,
        emissiveIntensity: 0.08,
        metalness: 0.22,
        roughness: 0.72,
    });
    const proxies = new THREE.InstancedMesh(
        proxyGeometry,
        proxyMaterial,
        proxyPlacements.length
    );
    for (let index = 0; index < proxyPlacements.length; index++) {
        proxies.setMatrixAt(index, proxyPlacements[index]);
    }
    proxies.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    proxies.instanceMatrix.needsUpdate = true;
    proxies.frustumCulled = false;
    this.lander.add(proxies);

    // Faint yellow points mark only settlements placed on the unlit hemisphere.
    // Depth testing keeps far-side lights correctly hidden by the Moon.
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0xffd36a,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
    });
    const glows = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.0018, 8, 6),
        glowMaterial,
        glowPlacements.length
    );
    for (let index = 0; index < glowPlacements.length; index++) {
        glows.setMatrixAt(index, glowPlacements[index]);
    }
    glows.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    glows.instanceMatrix.needsUpdate = true;
    glows.frustumCulled = false;
    glows.renderOrder = 3;
    this.lander.add(glows);

    this.lander.remove(normalizedModel);
    this.lander.position.set(0, 0, 0);
    this.lander.quaternion.identity();
    this.lander.scale.set(1, 1, 1);
    this.lander.visible = true;
  }

  loadWallpaperModel(url, targetGroup, targetSize, onReady) {
    this.gltfLoader.load(url, (gltf) => {
        const visual = gltf.scene;
        visual.traverse((object) => {
            if (!object.isMesh) return;
            object.castShadow = false;
            object.receiveShadow = false;
            if (!object.material) return;

            const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];
            for (const material of materials) {
                // Many spacecraft details are modeled as extremely thin
                // sheets. Rendering both faces prevents antennas, foil, and
                // struts from blinking out as their back faces turn toward us.
                material.side = THREE.DoubleSide;
                material.shadowSide = THREE.DoubleSide;

                // Tiny highly metallic polygons produce harsh sub-pixel
                // highlights. A modest roughness floor keeps their shape and
                // color while eliminating the white/black sparkle.
                if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
                    material.metalness = Math.min(material.metalness, 0.80);
                    material.roughness = Math.max(material.roughness, 0.48);
                    if (material.normalScale) material.normalScale.multiplyScalar(0.70);
                }

                if (material.alphaTest > 0) material.alphaToCoverage = true;
                for (const textureName of [
                    'map', 'normalMap', 'roughnessMap', 'metalnessMap',
                    'aoMap', 'emissiveMap'
                ]) {
                    const texture = material[textureName];
                    if (texture) texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
                }
                material.needsUpdate = true;
            }
        });

        visual.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(visual);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const largestDimension = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(largestDimension) || largestDimension <= 0) return;

        visual.position.copy(center).multiplyScalar(-1);
        const normalizedModel = new THREE.Group();
        normalizedModel.scale.setScalar(targetSize / largestDimension);
        normalizedModel.add(visual);
        targetGroup.add(normalizedModel);
        onReady?.(normalizedModel);
    }, undefined, (error) => console.warn(`Unable to load ${url}`, error));
  }

  colorIssSolarPanels(root) {
    root.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
            if (material.name !== 'shiny_panel') continue;
            material.color.set(0x2454a6);
            material.emissive?.set(0x0b2a70);
            material.emissiveMap = null;
            material.emissiveIntensity = 0.70;
            material.metalness = Math.min(material.metalness, 0.35);
            material.roughness = 0.52;
            material.needsUpdate = true;
        }
    });
  }

  issGeodeticToScene(latitude, longitude, altitudeKm, target) {
    const lat = THREE.MathUtils.degToRad(latitude);
    const lon = THREE.MathUtils.degToRad(longitude);
    const radius = 1 + altitudeKm / 6371;
    const cosLat = Math.cos(lat);
    return target.set(
        cosLat * Math.cos(lon),
        Math.sin(lat),
        -cosLat * Math.sin(lon)
    ).multiplyScalar(radius);
  }

  async requestLiveIssPosition() {
    if (this.displayRole !== 0 || this.issFetchInFlight) return;
    this.issFetchInFlight = true;
    this.issLastFetchAttempt = Date.now();

    try {
        const startTimestamp = Math.floor(Date.now() / 1000);
        const endTimestamp = startTimestamp + 20;
        const url = 'https://api.wheretheiss.at/v1/satellites/25544/positions'
            + `?timestamps=${startTimestamp},${endTimestamp}&units=kilometers`;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`ISS service returned ${response.status}`);
        const samples = await response.json();
        if (!Array.isArray(samples) || samples.length < 2) {
            throw new Error('ISS service returned an incomplete position pair');
        }

        this.issGeodeticToScene(
            Number(samples[0].latitude),
            Number(samples[0].longitude),
            Number(samples[0].altitude),
            this._issLiveFrom
        );
        this.issGeodeticToScene(
            Number(samples[1].latitude),
            Number(samples[1].longitude),
            Number(samples[1].altitude),
            this._issLiveTo
        );
        this.issLiveSegmentStart = Number(samples[0].timestamp) * 1000;
        this.issLiveSegmentEnd = Number(samples[1].timestamp) * 1000;
        this.issLiveDataReady = true;
        this.issApiWarningLogged = false;
    } catch (error) {
        if (!this.issApiWarningLogged) {
            console.warn('Live ISS data unavailable; retaining the fallback orbit.', error);
            this.issApiWarningLogged = true;
        }
    } finally {
        this.issFetchInFlight = false;
    }
  }

  lroHorizonsStateToScene(x, y, z, vx, vy, vz, positionTarget, velocityTarget) {
    // Horizons' Moon-equator frame uses Z as lunar north. Three.js uses Y as
    // up here, so remap axes and convert kilometres to the rendered Moon scale.
    const sceneUnitsPerKm = this.moonRadiusScene / 1737.4;
    positionTarget.set(x, z, -y).multiplyScalar(sceneUnitsPerKm);
    positionTarget.setLength(positionTarget.length() + this.lroVisualAltitudeOffset);
    velocityTarget.set(vx, vz, -vy).multiplyScalar(sceneUnitsPerKm);
  }

  formatHorizonsUtc(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
        + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }

  async requestLiveLroPosition() {
    if (this.displayRole !== 1 || this.lroFetchInFlight) return;
    this.lroFetchInFlight = true;
    this.lroLastFetchAttempt = Date.now();

    try {
        const now = Date.now();
        const startDate = new Date(now - 5000);
        const stopDate = new Date(now + 65000);
        const params = new URLSearchParams({
            format: 'json',
            COMMAND: "'-85'",
            OBJ_DATA: "'NO'",
            MAKE_EPHEM: "'YES'",
            EPHEM_TYPE: "'VECTORS'",
            CENTER: "'500@301'",
            START_TIME: `'${this.formatHorizonsUtc(startDate)}'`,
            STOP_TIME: `'${this.formatHorizonsUtc(stopDate)}'`,
            STEP_SIZE: "'1 m'",
            VEC_TABLE: "'2'",
            REF_PLANE: "'B'",
            OUT_UNITS: "'KM-S'",
            VEC_CORR: "'NONE'",
            CSV_FORMAT: "'YES'",
            TIME_TYPE: "'UT'"
        });
        const horizonsUrl = `https://ssd.jpl.nasa.gov/api/horizons.api?${params}`;
        let response;
        try {
            response = await fetch(horizonsUrl, { cache: 'no-store' });
        } catch {
            // Horizons serves the authoritative data but does not permit
            // cross-origin browser reads. This read-only text bridge makes the
            // same public response accessible to Lively's embedded browser.
            const bridgeUrl = `https://r.jina.ai/http://${horizonsUrl.slice('https://'.length)}`;
            response = await fetch(bridgeUrl, { cache: 'no-store' });
        }
        if (!response.ok) throw new Error(`Horizons returned ${response.status}`);
        const responseText = await response.text();
        const jsonStart = responseText.indexOf('{');
        if (jsonStart < 0) throw new Error('Horizons bridge returned no JSON');
        const payload = JSON.parse(responseText.slice(jsonStart));
        if (payload.error || typeof payload.result !== 'string') {
            throw new Error(payload.error || 'Horizons returned no ephemeris');
        }

        const ephemeris = payload.result.split('$$SOE')[1]?.split('$$EOE')[0];
        const rows = ephemeris?.trim().split(/\r?\n/).filter(Boolean) || [];
        if (rows.length < 2) throw new Error('Horizons returned too few LRO samples');

        const parseRow = (row) => {
            const fields = row.split(',').map((field) => field.trim());
            const values = fields.slice(2, 8).map(Number);
            if (values.some((value) => !Number.isFinite(value))) {
                throw new Error('Horizons returned an invalid LRO state vector');
            }
            return {
                timestamp: (Number(fields[0]) - 2440587.5) * 86400000,
                values
            };
        };
        const first = parseRow(rows[0]);
        const second = parseRow(rows[1]);
        this.lroHorizonsStateToScene(
            ...first.values,
            this._lroLiveFrom,
            this._lroLiveVelocityFrom
        );
        this.lroHorizonsStateToScene(
            ...second.values,
            this._lroLiveTo,
            this._lroLiveVelocityTo
        );
        this.lroLiveSegmentStart = first.timestamp;
        this.lroLiveSegmentEnd = second.timestamp;
        this.lroLiveDataReady = true;
        this.lroApiWarningLogged = false;
    } catch (error) {
        if (!this.lroApiWarningLogged) {
            console.warn('Live LRO data unavailable; retaining the fallback orbit.', error);
            this.lroApiWarningLogged = true;
        }
    } finally {
        this.lroFetchInFlight = false;
    }
  }

  updateOrbitalFeatures(nowMs) {
    const featureElapsed = Math.max(0, nowMs - this.featureStartTime);
    if (this.displayRole === 0
        && Date.now() - this.issLastFetchAttempt >= this.issFetchInterval) {
        this.requestLiveIssPosition();
    }
    if (this.displayRole === 1
        && Date.now() - this.lroLastFetchAttempt >= this.lroFetchInterval) {
        this.requestLiveLroPosition();
    }

    if (this.issLiveDataReady) {
        const liveProgress = THREE.MathUtils.clamp(
            (nowMs - this.issLiveSegmentStart)
                / Math.max(1, this.issLiveSegmentEnd - this.issLiveSegmentStart),
            0,
            1
        );
        this.iss.position.lerpVectors(this._issLiveFrom, this._issLiveTo, liveProgress);
        this._issTangent.copy(this._issLiveTo).sub(this._issLiveFrom).normalize();
        this.issOrbitRadius = this.iss.position.length();
    } else {
        // Offline fallback used only until the first live position arrives.
        const issAngle = (featureElapsed % this.issOrbitPeriod) / this.issOrbitPeriod * Math.PI * 2;
        this._issPosition.set(
            Math.cos(issAngle) * this.issOrbitRadius,
            0,
            Math.sin(issAngle) * this.issOrbitRadius
        ).applyAxisAngle(this._issAxis, this.issInclination);
        this._issTangent.set(
            -Math.sin(issAngle),
            0,
            Math.cos(issAngle)
        ).applyAxisAngle(this._issAxis, this.issInclination).normalize();
        this.iss.position.copy(this._issPosition);
    }
    this.iss.quaternion.setFromUnitVectors(this._issForward, this._issTangent);
    if (this.displayRole === 0) {
        const cameraDistanceFromEarth = this.camera.position.length();
        const nearestIssDistance = Math.max(0.001, cameraDistanceFromEarth - this.issOrbitRadius);
        const farthestIssDistance = cameraDistanceFromEarth + this.issOrbitRadius;
        const currentIssDistance = this.camera.position.distanceTo(this.iss.position);
        const distanceProgress = THREE.MathUtils.clamp(
            (currentIssDistance - nearestIssDistance) / (farthestIssDistance - nearestIssDistance),
            0,
            1
        );

        // Perspective alone gives only about a 2:1 change at this orbit. Scale
        // the physical model in concert with distance so its final on-screen
        // size is 8:1, while preserving the existing closest appearance.
        const desiredApparentScale = THREE.MathUtils.lerp(
            this.issNearApparentScale,
            this.issFarApparentScale,
            distanceProgress
        );
        const perspectiveCompensation = currentIssDistance / nearestIssDistance;
        this.iss.scale.setScalar(desiredApparentScale * perspectiveCompensation);
    }

    if (this.lroLiveDataReady) {
        const liveProgress = THREE.MathUtils.clamp(
            (nowMs - this.lroLiveSegmentStart)
                / Math.max(1, this.lroLiveSegmentEnd - this.lroLiveSegmentStart),
            0,
            1
        );
        this._lroPosition.lerpVectors(this._lroLiveFrom, this._lroLiveTo, liveProgress);
        this._lroTangent.lerpVectors(
            this._lroLiveVelocityFrom,
            this._lroLiveVelocityTo,
            liveProgress
        ).normalize();
        this.lroOrbitRadius = this._lroPosition.length();
    } else {
        const lroAngle = (featureElapsed % this.lroOrbitPeriod)
            / this.lroOrbitPeriod * Math.PI * 2;
        this._lroPosition.set(
            Math.cos(lroAngle) * this.lroOrbitRadius,
            0,
            Math.sin(lroAngle) * this.lroOrbitRadius
        ).applyAxisAngle(this._lroAxis, this.lroInclination);
        this._lroTangent.set(
            -Math.sin(lroAngle),
            0,
            Math.cos(lroAngle)
        ).applyAxisAngle(this._lroAxis, this.lroInclination).normalize();
    }
    this.lro.position.copy(this._lroPosition);
    this.lro.quaternion.setFromUnitVectors(this._lroForward, this._lroTangent);

    if (this.displayRole === 1) {
        this.moon.updateMatrixWorld(true);
        this.lro.getWorldPosition(this._lroWorldPosition);
        const cameraDistanceFromMoon = this.camera.position.distanceTo(this.moon.position);
        const nearestLroDistance = Math.max(0.001, cameraDistanceFromMoon - this.lroOrbitRadius);
        const farthestLroDistance = cameraDistanceFromMoon + this.lroOrbitRadius;
        const currentLroDistance = this.camera.position.distanceTo(this._lroWorldPosition);
        const distanceProgress = THREE.MathUtils.clamp(
            (currentLroDistance - nearestLroDistance) / (farthestLroDistance - nearestLroDistance),
            0,
            1
        );
        const desiredApparentScale = THREE.MathUtils.lerp(
            this.lroNearApparentScale,
            this.lroFarApparentScale,
            distanceProgress
        );
        const perspectiveCompensation = currentLroDistance / nearestLroDistance;
        this.lro.scale.setScalar(desiredApparentScale * perspectiveCompensation);
    }
    this.iss.visible = this.displayRole === 0 && this.issModelReady;
    this.lro.visible = this.displayRole === 1 && this.lroModelReady;
    this.lander.visible = this.displayRole === 1 && this.landerModelReady;
  }

  getActiveViewTarget(target) {
    if (this.activeView === 'moon') {
        return target.copy(this.moonPosition);
    }

    return target.set(0, 0, 0);
  }

  updateCameraFromOrbit() {
    this.getActiveViewTarget(this._viewTarget);
    this.camera.position.setFromSpherical(this.currentSpherical).add(this._viewTarget);
    this.camera.lookAt(this._viewTarget);
  }

  getMoonSunVisibility() {
    this._sunFromCamera.copy(this.sunPosition).sub(this.camera.position);
    this._moonFromCamera.copy(this.moonPosition).sub(this.camera.position);

    const sunDistance = this._sunFromCamera.length();
    const moonDistance = this._moonFromCamera.length();
    if (moonDistance >= sunDistance || moonDistance <= this.moonRadiusScene) return 1;

    this._sunFromCamera.multiplyScalar(1 / sunDistance);
    this._moonFromCamera.multiplyScalar(1 / moonDistance);

    const separation = Math.acos(THREE.MathUtils.clamp(
        this._sunFromCamera.dot(this._moonFromCamera), -1, 1
    ));
    const sunAngularRadius = Math.asin(THREE.MathUtils.clamp(
        this.METRIC_SUN_RADIUS / sunDistance, 0, 1
    ));
    const moonAngularRadius = Math.asin(THREE.MathUtils.clamp(
        this.moonRadiusScene / moonDistance, 0, 1
    ));
    const overlapEnd = sunAngularRadius + moonAngularRadius;

    if (separation >= overlapEnd) return 1;

    const fullOcclusionEnd = Math.abs(moonAngularRadius - sunAngularRadius);
    if (separation <= fullOcclusionEnd) return 0;

    return THREE.MathUtils.smoothstep(separation, fullOcclusionEnd, overlapEnd);
  }

  switchView(nextView) {
    if (nextView !== 'earth' && nextView !== 'moon') return;
    if (nextView === this.activeView) return;

    this.activeView = nextView;
    this.clouds.visible = true;

    // Refresh the Moon's live position before centering the camera on it.
    this.updateSunPosition();

    const framingDistance = nextView === 'moon'
        ? this.moonFramingDistance
        : this.earthFramingDistance;

    this.currentSpherical.radius = framingDistance;
    this.targetSpherical.copy(this.currentSpherical);
    this.originalSpherical.copy(this.currentSpherical);
    this.isInteractive = false;
    this.isSettled = true;
    this.lastAutoRotate = performance.now();
    this.updateCameraFromOrbit();
    this.renderOnce();
  }

  renderOnce() {
    this.updateSunPosition();
    this.updateOrbitalFeatures(Date.now());
    // Treat the stars as an infinite, camera-centered sky. Aligning their frame
    // to the camera removes the curved diagonal motion caused by each body's
    // different camera tilt; a shared local yaw produces uniform horizontal drift.
    if (this.starField.points) {
        this.starField.points.position.copy(this.camera.position);
        const starDriftAngle = (Date.now() % this.starDriftPeriod)
            / this.starDriftPeriod * Math.PI * 2;
        this._starDriftQuaternion.setFromAxisAngle(this._starDriftAxis, starDriftAngle);
        this.starField.points.quaternion.copy(this.camera.quaternion)
            .multiply(this._starDriftQuaternion)
            .multiply(this._starCatalogQuaternion);
        // Planets share the same effectively infinite celestial sphere, so
        // their drift direction and speed exactly match the star background.
        this.planetsMesh.position.copy(this.starField.points.position);
        this.planetsMesh.quaternion.copy(this.starField.points.quaternion);
    }
    this.sunGroup.position.copy(this.sunPosition);
    this.sunQuad.quaternion.copy(this.camera.quaternion);

    this._rawSunNDC.copy(this.sunPosition).project(this.camera);

    this.flareSystem.updateOcclusion(
        this.sunPosition,
        this.camera,
        this.METRIC_SUN_DIST,
        this.METRIC_SUN_RADIUS,
        this.params.flareDimCurveExponent,
        this._rawSunNDC
    );
    const moonSunVisibility = this.getMoonSunVisibility();
    this.flareSystem.visibilityFactor *= moonSunVisibility;
    this.flareSystem.flareMaterial.uniforms.uVisibility.value = this.flareSystem.visibilityFactor;
    this.flareSystem.updateScreenSpace();
    this.updateExposure(this._rawSunNDC);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.flareSystem.flareScene, this.flareSystem.flareOrthoCamera);
  }

  updateSunPosition() {
    this.sunPosCalc.update(this.sunPosition);
    this.sunLight.position.copy(this.sunPosition);

    const nowMs = Date.now();
    const T = (nowMs / 86400000 - 10957.5) / 36525.0;

    // Compute GMST (Greenwich Mean Sidereal Time)
    const jd = nowMs / 86400000 + 2440587.5;
    const d = jd - 2451545.0;
    const gmstDeg = (280.46061837 + 360.98564736629 * d) % 360;
    const gmstHours = gmstDeg / 15;

    // Update planets with GMST
    this.planetPositions.update(T, gmstHours, this.planetPosArray);
    this.planetGeo.attributes.position.needsUpdate = true;

    // Moon position (true live position, no offset)
    this.moonPosCalc.update(nowMs, gmstHours, this.moonPosition);
    this.moon.position.copy(this.moonPosition);

    // Tidal lock: rotate so the sphere's +Z (texture centre = near side) always faces Earth
    this._moonToEarth.copy(this.moonPosition).negate().normalize();
    this._moonLockQ.setFromUnitVectors(this._moonForward, this._moonToEarth);
    this.moon.quaternion.copy(this._moonLockQ);
  }

  updateExposure(rawSunNDC) {
    this._camDirWS.copy(this.camera.position).normalize();
    this._sunDirWS.copy(this.sunPosition).normalize();

    const earthPhase = this._camDirWS.dot(this._sunDirWS);
    const dayBlend = THREE.MathUtils.smoothstep(earthPhase, -0.8, 0.8);

    const margin = 0.05;
    const edgeFade = THREE.MathUtils.smoothstep(
        Math.max(Math.abs(rawSunNDC.x), Math.abs(rawSunNDC.y)),
        1.0 - margin,
        1.0 + margin
    );
    const onScreenFactor = 1.0 - edgeFade;

    const sunGlare = onScreenFactor * this.flareSystem.visibilityFactor;
    const dimDemand = Math.max(dayBlend, sunGlare);

    const nightExp = this.params.exposureNighttime;
    const dayExp   = this.params.exposureDaytime;
    const t = this.params.sunGlareStrength;
    const minExp = THREE.MathUtils.lerp(nightExp, dayExp, t);
    const exposure = THREE.MathUtils.lerp(nightExp, minExp, dimDemand);

    // Keep stars visible even when the bright daytime Earth lowers the scene
    // exposure. Previously they fell to 15% brightness on half of the orbit.
    this.starField.setExposure(Math.max(exposure, 1.0));
    this.planetMaterial.uniforms.uExposure.value = exposure;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.flareSystem.updateAspect(this.camera.aspect);
  }
}

const app = new EarthApp();
