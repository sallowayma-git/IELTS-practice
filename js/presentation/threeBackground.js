(function initShuiThreeBackground(global) {
    'use strict';

    const THREE = global.THREE;

    const vertexShader = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `;

    const shaders = {
        'misty-mountain': `
            precision mediump float;
            varying vec2 vUv;
            uniform float uTime;
            uniform vec2 uResolution;

            float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }
            float noise(vec2 p){
                vec2 ip = floor(p); vec2 u = fract(p); u = u*u*(3.0-2.0*u);
                float res = mix(
                    mix(rand(ip), rand(ip+vec2(1.0,0.0)), u.x),
                    mix(rand(ip+vec2(0.0,1.0)), rand(ip+vec2(1.0,1.0)), u.x), u.y);
                return res*res;
            }

            void main() {
                vec2 uv = vUv;
                float aspect = uResolution.x / max(uResolution.y, 1.0);
                vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
                float totalTime = uTime * 0.2;
                float dispersion = smoothstep(2.0, 12.0, uTime);
                vec2 q = p;
                float warpScale = 0.015 + 0.435 * dispersion;
                q.x += sin(p.y * 3.5 + totalTime * 1.2) * warpScale;
                q.y += cos(p.x * 3.1 - totalTime * 1.5) * warpScale;
                q.x += sin(q.y * 5.2 - totalTime * 0.8) * warpScale * 0.5;
                q.y += cos(q.x * 4.7 + totalTime * 0.9) * warpScale * 0.5;

                vec3 bgColor   = vec3(0.92, 0.90, 0.88); 
                vec3 sunColor  = vec3(0.98, 0.45, 0.35); 
                vec3 mountColor= vec3(0.15, 0.25, 0.60); 
                vec3 fogColor  = vec3(0.60, 0.55, 0.80); 
                vec3 color = bgColor;

                vec2 sunCenter = vec2(0.0, 0.15); 
                float sunDist = length(q - sunCenter);
                float sunAlpha = 1.0 - smoothstep(0.12, 0.35 + dispersion * 0.25, sunDist);
                color = mix(color, sunColor, sunAlpha * 0.9);

                float absX = abs(q.x);
                float peakY = -absX * 0.85 - (absX * absX) * 1.5 + 0.08;
                float mountDist = q.y - peakY;
                float mountAlpha = 1.0 - smoothstep(-0.1, 0.15 + dispersion * 0.45, mountDist);
                float mountDepth = 1.0 - smoothstep(-0.6, 0.1, q.y);
                vec3 finalMountColor = mix(mountColor, vec3(0.05, 0.10, 0.30), mountDepth * 0.7);
                color = mix(color, finalMountColor, mountAlpha * 0.95);

                float bottomFog = 1.0 - smoothstep(-0.5, 0.2, q.y + noise(q * 2.5 - totalTime) * 0.3);
                color = mix(color, fogColor, bottomFog * 0.65);

                float mergeNoise = noise(q * 3.0 + totalTime * 1.5);
                color = mix(color, sunColor, mergeNoise * mountAlpha * 0.35 * dispersion);

                float halo1 = 1.0 - smoothstep(0.0, 0.8, length(p - vec2(-0.35, -0.2) + vec2(sin(totalTime), cos(totalTime)) * 0.15));
                float halo2 = 1.0 - smoothstep(0.0, 0.9, length(p - vec2(0.4, 0.15) + vec2(cos(totalTime*0.8), sin(totalTime*0.9)) * 0.2));
                color = mix(color, sunColor, halo1 * 0.12);
                color = mix(color, fogColor, halo2 * 0.15);

                float bloom = 1.0 - smoothstep(0.0, 0.5, mountDist);
                color = mix(color, sunColor, bloom * 0.15 * (1.0 - mountAlpha));

                float vignette = length(p) * 0.4;
                color -= vignette * 0.12;

                gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
            }
        `,
        'teal-ocean': `
            precision mediump float;
            varying vec2 vUv;
            uniform float uTime;
            uniform vec2 uResolution;

            float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
            float vnoise(vec2 p) {
                vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(random(i), random(i + vec2(1.0,0.0)), u.x),
                           mix(random(i + vec2(0.0,1.0)), random(i + vec2(1.0,1.0)), u.x), u.y);
            }
            float fbm(vec2 p) {
                float v = 0.0; float a = 0.5;
                mat2 rot = mat2(0.87758, 0.47942, -0.47942, 0.87758);
                for (int i = 0; i < 4; ++i) {
                    v += a * vnoise(p); p = rot * p * 2.0 + vec2(100.0); a *= 0.5;
                }
                return v;
            }

            void boatSDF(vec2 p, out float hullD, out float sailD) {
                vec2 hp = p - vec2(0.0, -0.01);
                vec2 hd = abs(hp) - vec2(0.055 + hp.y * 1.5, 0.01);
                hullD = length(max(hd, 0.0)) + min(max(hd.x, hd.y), 0.0) - 0.005;
                vec2 mp = p - vec2(0.01, 0.04);
                hullD = min(hullD, max(abs(mp.x) - 0.002, abs(mp.y) - 0.06));
                vec2 s1 = p - vec2(0.015, 0.02);
                float sail1 = max(max(s1.x - 0.06, -s1.x), max(s1.y - 0.14, -s1.y));
                sailD = max(sail1, s1.x * 0.89 + s1.y * 0.45 - 0.06);
                vec2 s2 = p - vec2(-0.005, 0.02);
                float sail2 = max(max(-s2.x - 0.04, s2.x), max(s2.y - 0.12, -s2.y));
                sailD = min(sailD, max(sail2, -s2.x * 0.89 + s2.y * 0.45 - 0.06));
            }

            void main() {
                float aspect = uResolution.x / max(uResolution.y, 1.0);
                vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
                float totalTime = uTime * 0.5;
                float horizon = 0.15;
                
                vec3 skyBase = vec3(0.55, 0.60, 0.62);
                float cloudTime = totalTime * 0.1;
                vec2 qt = p * vec2(2.5, 3.5) + vec2(cloudTime, 0.0);
                float density = fbm(qt);
                float densityHigh = fbm(qt + vec2(0.04, 0.04));
                float volLight = smoothstep(-0.02, 0.12, densityHigh - density);
                float skyMask = smoothstep(0.3, 0.75, density + p.y * 0.4);
                vec3 colDark = vec3(0.60, 0.65, 0.70);
                vec3 colLight = vec3(0.95, 0.98, 1.00);
                vec3 cloudVolColor = mix(colDark, colLight, volLight);
                vec3 skyColor = mix(skyBase, cloudVolColor, skyMask);
                
                vec3 waterDeep = vec3(0.01, 0.18, 0.22); vec3 waterMid = vec3(0.02, 0.35, 0.38); vec3 waterLight = vec3(0.05, 0.45, 0.45);
                float wave1 = sin(p.x * 25.0 + totalTime * 2.0) * 0.5 + 0.5;
                float wave2 = sin(p.x * 50.0 - totalTime * 2.5 + p.y * 150.0) * 0.5 + 0.5;
                float waveNoise = fbm(p * vec2(12.0, 60.0) + vec2(totalTime * 0.15, totalTime * 0.3));
                float waveBlend = wave1 * 0.2 + wave2 * 0.15 + waveNoise * 0.65;
                float depthMts = smoothstep(horizon - 0.15, horizon, p.y);
                
                vec3 oceanColor = mix(waterDeep, waterMid, (p.y + 0.5) / 0.65);
                oceanColor = mix(oceanColor, waterLight, waveBlend * (1.0 - depthMts*0.8) * 0.6);
                float spec = smoothstep(0.7, 1.0, waveNoise) * smoothstep(0.0, 0.15, horizon - p.y);
                oceanColor += spec * 0.15 * vec3(0.8,0.9,0.9);

                vec2 bp = p - vec2(0.0, -0.12);
                float tilt = sin(totalTime * 1.5) * 0.03; 
                bp = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * bp; 
                bp.y += sin(totalTime * 2.1) * 0.005;
                
                float scale = 1.6;
                bp /= scale;

                vec3 finalColor = p.y > horizon ? skyColor : oceanColor;
                
                float hullD, sailD;
                boatSDF(bp, hullD, sailD);
                
                float px = (1.5 / max(uResolution.x, uResolution.y)) / scale;
                float hullMask = 1.0 - smoothstep(0.0, px, hullD);
                float sailMask = 1.0 - smoothstep(0.0, px, sailD);
                
                finalColor = mix(finalColor, vec3(0.08, 0.12, 0.15), hullMask);
                finalColor = mix(finalColor, vec3(0.92, 0.95, 0.98), sailMask);

                float vig = length(p) * 0.5;
                finalColor -= vig * 0.15;
                gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
            }
        `,
        'floral-bloom': `
            precision mediump float;
            varying vec2 vUv;
            uniform vec2 uResolution;

            float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }

            mat2 rot(float a) {
                float s = sin(a), c = cos(a);
                return mat2(c, -s, s, c);
            }

            // Photographic lens-like soft falloff
            float soft(float dist, float radius, float feather) {
                return smoothstep(radius + feather, radius - feather, dist);
            }

            void main() {
                float aspect = uResolution.x / max(uResolution.y, 1.0);
                vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
                
                // 1. Precise Background Gradient
                vec3 cBot = vec3(0.40, 0.60, 0.90);
                vec3 cTop = vec3(0.98, 0.86, 0.76); 
                float bgMix = smoothstep(-0.4, 0.4, p.y + p.x * 0.1); 
                vec3 color = mix(cBot, cTop, bgMix);
                
                // Pinkish haze in upper left & warmth on right
                float hazeL = soft(length(p - vec2(-0.3, 0.2)), 0.4, 0.4);
                color = mix(color, vec3(0.98, 0.65, 0.75), hazeL * 0.4);
                float hazeR = soft(length(p - vec2(0.4, 0.0)), 0.5, 0.5);
                color = mix(color, vec3(0.98, 0.8, 0.6), hazeR * 0.5);

                // Pink/Magenta glow strictly behind top blue flower
                float topGlow = soft(length(p - vec2(-0.02, 0.25)), 0.12, 0.25);
                color = mix(color, vec3(0.95, 0.5, 0.8), topGlow * 0.65);

                // 2. Base Dark Cluster and Stems
                // Moved root up to shorten stems
                vec2 bp = p - vec2(-0.02, -0.28);
                float baseDark = soft(length(vec2(bp.x * 1.5, bp.y)), 0.12, 0.3);
                color = mix(color, vec3(0.04, 0.25, 0.50), baseDark * 0.9);

                float stemBottomFold = smoothstep(-0.35, -0.2, p.y); // Fades stems exactly at new root

                // Main central stem (MUST FADE OUT before the flower bulb)
                float mainStem = soft(abs(p.x + 0.01 + p.y * 0.05), 0.005, 0.04) * smoothstep(0.12, 0.0, p.y) * stemBottomFold;
                color = mix(color, vec3(0.1, 0.4, 0.45), mainStem * 0.6);

                // Stem to left flower & small right leaf
                // Re-routed to the new left position (-0.35, -0.16)
                float stemLeft = soft(abs(p.x + p.y * 1.17 + 0.55), 0.003, 0.03) * smoothstep(-0.05, -0.15, p.y) * stemBottomFold;
                color = mix(color, vec3(0.12, 0.35, 0.4), stemLeft * 0.5);

                // Stem to right cloned flower (Flower 4)
                // Adjusted path for new position (0.45, -0.20)
                float stemRight = soft(abs(p.x - p.y * 0.4 - 0.37), 0.003, 0.03) * smoothstep(-0.05, -0.18, p.y) * stemBottomFold;
                color = mix(color, vec3(0.12, 0.35, 0.4), stemRight * 0.4);

                vec2 pLeaf = p - vec2(0.04, -0.1); pLeaf *= rot(0.5);
                float leaf = soft(length(vec2(pLeaf.x * 2.5, pLeaf.y)), 0.01, 0.06);
                color = mix(color, vec3(0.1, 0.3, 0.45), leaf * 0.7);

                // 3. Flower 3: Right Peach Flower (furthest back)
                // Moved back down to (0.35, 0.02)
                vec2 pF3 = p - vec2(0.35, 0.02);
                pF3 *= rot(-0.4);
                float a3 = atan(pF3.y, pF3.x); float r3 = length(pF3);
                float rLimit3 = 0.26 * (0.9 + 0.1 * sin(a3 * 4.0));
                float f3 = soft(r3, rLimit3 - 0.08, 0.18);
                float core3 = soft(r3, 0.02, 0.1);
                vec3 cF3 = mix(vec3(0.98, 0.5, 0.3), vec3(0.99, 0.75, 0.55), r3 * 3.0);
                color = mix(color, cF3, f3 * 0.85);
                color = mix(color, vec3(0.98, 0.3, 0.15), core3 * 0.5);

                // 4. Top Blue Flower (Middle layer)
                vec2 pBulb = p - vec2(-0.03, 0.13); // Greenish calyx/bulb
                float bulb = soft(length(vec2(pBulb.x * 1.5, pBulb.y)), 0.03, 0.04);
                color = mix(color, vec3(0.15, 0.5, 0.45), bulb * 0.95);

                vec2 pF2 = p - vec2(-0.03, 0.25);
                pF2 *= rot(-0.1); 
                float a2 = atan(pF2.y, pF2.x); float r2 = length(pF2);
                float inner2 = smoothstep(-0.05, 0.1, pF2.y); 
                vec3 cF2 = mix(vec3(0.2, 0.35, 0.75), vec3(0.65, 0.8, 0.98), inner2);
                
                float lobe2 = 0.16 * (0.65 + 0.35 * pow(abs(sin(a2 * 2.5)), 1.2)); // 5 distinct petals
                float f2 = soft(r2, lobe2 - 0.02, 0.04);
                color = mix(color, cF2, f2 * 0.92);
                // Center shadow core 
                float core2 = soft(length(pF2 - vec2(0.01, -0.06)), 0.02, 0.05);
                color = mix(color, vec3(0.1, 0.25, 0.45), core2 * 0.85);

                // 5. Flower 1: Left Orange Flower (Foreground)
                // Leftmost placement, bisected by card edge at x=-0.35
                vec2 pF1 = p - vec2(-0.35, -0.16);
                pF1 *= rot(0.25);
                float a1 = atan(pF1.y, pF1.x); float r1 = length(pF1);
                float lobe1 = 0.18 * (0.8 + 0.2 * abs(sin(a1 * 3.5))); 
                float f1 = soft(r1, lobe1 - 0.03, 0.07);
                
                vec3 cF1 = mix(vec3(0.98, 0.35, 0.1), vec3(0.98, 0.65, 0.4), r1 * 4.0);
                color = mix(color, cF1, f1 * 0.95);
                
                // Hot red core
                float core1 = soft(length(pF1 - vec2(0.005, 0.0)), 0.01, 0.07);
                color = mix(color, vec3(0.98, 0.12, 0.02), core1 * 0.9);

                // 6. Flower 4: Right Orange Flower (Clone of Flower 1)
                // Moved Right by +0.2 -> New Pos: (0.45, -0.20)
                vec2 pF4 = p - vec2(0.45, -0.20);
                pF4 *= rot(-0.6); 
                float a4 = atan(pF4.y, pF4.x); float r4 = length(pF4);
                float lobe4 = 0.16 * (0.8 + 0.2 * abs(sin(a4 * 3.5))); 
                float f4 = soft(r4, lobe4 - 0.03, 0.07);
                vec3 cF4 = mix(vec3(0.98, 0.35, 0.1), vec3(0.98, 0.65, 0.4), r4 * 4.0);
                color = mix(color, cF4, f4 * 0.9);
                float core4 = soft(length(pF4 - vec2(-0.005, 0.0)), 0.01, 0.07);
                color = mix(color, vec3(0.98, 0.12, 0.02), core4 * 0.85);
                
                // 7. Photographic Texture & Vignette
                float n1 = random(vUv * 123.456 + fract(random(vUv)));
                float n2 = random(vUv * 345.678 - fract(random(vUv*2.0)));
                float noise = (n1 + n2 - 1.0) * 0.04; 
                
                float vig = length(p);
                color *= 1.0 - vig * 0.18;
                color += noise;

                gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
            }
        `
    };

    function createBackground(theme = 'misty-mountain') {
        if (!THREE) {
            document.body.classList.add('three-bg-fallback');
            return null;
        }
        if (!global.WebGLRenderingContext) {
            document.body.classList.add('three-bg-fallback');
            return null;
        }

        const renderer = new THREE.WebGLRenderer({
            antialias: false,
            alpha: false,
            preserveDrawingBuffer: true,
            powerPreference: 'low-power'
        });
        renderer.domElement.id = 'shui-three-bg';
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.setClearColor(0xf5f6f8, 1);
        
        // Remove existing canvas if any
        const existing = document.getElementById('shui-three-bg');
        if (existing) existing.remove();
        document.body.prepend(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const uniforms = {
            uTime: { value: 0 },
            uResolution: { value: new THREE.Vector2(1, 1) }
        };
        
        const fragmentShader = shaders[theme] || shaders['misty-mountain'];

        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader,
            fragmentShader,
            depthTest: false,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        scene.add(mesh);

        let rafId = 0;
        let lastFrame = 0;
        let paused = false;
        const startedAt = performance.now();
        const frameInterval = 1000 / 24;

        function resize() {
            const width = Math.max(1, global.innerWidth || 1);
            const height = Math.max(1, global.innerHeight || 1);
            const ratio = Math.min(global.devicePixelRatio || 1, 1.5);
            renderer.setPixelRatio(ratio);
            renderer.setSize(width, height, false);
            uniforms.uResolution.value.set(width * ratio, height * ratio);
            render(performance.now(), true);
        }

        function render(now, force) {
            if (paused && !force) {
                rafId = global.requestAnimationFrame(render);
                return;
            }
            if (!force && now - lastFrame < frameInterval) {
                rafId = global.requestAnimationFrame(render);
                return;
            }
            lastFrame = now;
            uniforms.uTime.value = (now - startedAt) / 1000;
            renderer.render(scene, camera);
            if (!force) {
                rafId = global.requestAnimationFrame(render);
            }
        }

        function handleVisibility() {
            paused = document.hidden;
            if (!paused) {
                render(performance.now(), true);
            }
        }

        resize();
        global.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', handleVisibility);
        render(performance.now(), true);
        rafId = global.requestAnimationFrame(render);

        document.body.classList.add('three-bg-active');

        return {
            renderer,
            refresh: () => render(performance.now(), true),
            destroy() {
                if (rafId) {
                    global.cancelAnimationFrame(rafId);
                    rafId = 0;
                }
                global.removeEventListener('resize', resize);
                document.removeEventListener('visibilitychange', handleVisibility);
                renderer.dispose();
                material.dispose();
                mesh.geometry.dispose();
                if (renderer.domElement.parentNode) {
                    renderer.domElement.remove();
                }
            }
        };
    }

    function start(themeName = null) {
        if (!themeName) {
            try {
                themeName = localStorage.getItem('three_bg_theme') || 'misty-mountain';
            } catch(e) {
                themeName = 'misty-mountain';
            }
        }
        
        try {
            if (global.SHUIThreeBackground) {
                global.SHUIThreeBackground.destroy();
            }
            global.SHUIThreeBackground = createBackground(themeName);
        } catch (error) {
            console.warn('[SHUI Three Background] fallback applied:', error);
            document.body.classList.add('three-bg-fallback');
        }
    }

    global.switchBgTheme = function(themeName) {
        try {
            localStorage.setItem('three_bg_theme', themeName);
        } catch(e){}
        start(themeName);
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', () => start(), { once: true });
    }
})(typeof window !== 'undefined' ? window : this);
