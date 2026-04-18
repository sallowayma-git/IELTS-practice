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

    const fragmentShader = `
        precision mediump float;

        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uResolution;

        // Grain/Noise function for stylistic texture
        float rand(vec2 n) { 
            return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
        }

        // 2D Value Noise
        float noise(vec2 p){
            vec2 ip = floor(p);
            vec2 u = fract(p);
            u = u*u*(3.0-2.0*u);
            float res = mix(
                mix(rand(ip), rand(ip+vec2(1.0,0.0)), u.x),
                mix(rand(ip+vec2(0.0,1.0)), rand(ip+vec2(1.0,1.0)), u.x), u.y);
            return res*res;
        }

        void main() {
            vec2 uv = vUv;
            float aspect = uResolution.x / max(uResolution.y, 1.0);
            
            // Centralize coordinates: Origin (0,0) is at the exact center of the screen
            vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

            // Time scaling
            float totalTime = uTime * 0.2;
            
            // Progressive dispersion logic
            // Morph progressively from original shape to fluid soup over 2 to 12 seconds
            float dispersion = smoothstep(2.0, 12.0, uTime);

            // Base coordinate for domain warping
            vec2 q = p;
            
            // As dispersion grows, warp multiplier grows
            // Starts with a tiny micro-breathing (0.015) and ends in wild fluid waves (0.45)
            float warpScale = 0.015 + 0.435 * dispersion;
            
            // Continuous breathing displacement
            q.x += sin(p.y * 3.5 + totalTime * 1.2) * warpScale;
            q.y += cos(p.x * 3.1 - totalTime * 1.5) * warpScale;
            
            q.x += sin(q.y * 5.2 - totalTime * 0.8) * warpScale * 0.5;
            q.y += cos(q.x * 4.7 + totalTime * 0.9) * warpScale * 0.5;

            // Palette Definition based on the uploaded image
            vec3 bgColor   = vec3(0.92, 0.90, 0.88); // Warm off-white mist
            vec3 sunColor  = vec3(0.98, 0.45, 0.35); // Soft Sunset Pink/Orange
            vec3 mountColor= vec3(0.15, 0.25, 0.60); // Deep mist Blue peak
            vec3 fogColor  = vec3(0.60, 0.55, 0.80); // Purple/blue transition fog

            vec3 color = bgColor;

            // 1. Warped Sun (Circle SDF)
            vec2 sunCenter = vec2(0.0, 0.15); 
            float sunDist = length(q - sunCenter);
            // Sun edge softens as it disperses
            float sunAlpha = 1.0 - smoothstep(0.12, 0.35 + dispersion * 0.25, sunDist);
            color = mix(color, sunColor, sunAlpha * 0.9);

            // 2. Warped Mountain Peak (Sweeping SDF)
            // Shape: Wider mountain peak sweeping outwards at the bottom
            float absX = abs(q.x);
            float peakY = -absX * 0.85 - (absX * absX) * 1.5 + 0.08;
            float mountDist = q.y - peakY;
            // The boundary blurs more heavily as dispersion kicks in
            float mountAlpha = 1.0 - smoothstep(-0.1, 0.15 + dispersion * 0.45, mountDist);
            
            // Gradient inside the mountain (darker at the bottom)
            float mountDepth = 1.0 - smoothstep(-0.6, 0.1, q.y);
            vec3 finalMountColor = mix(mountColor, vec3(0.05, 0.10, 0.30), mountDepth * 0.7);
            
            color = mix(color, finalMountColor, mountAlpha * 0.95);

            // 3. Misty fog overlay blending from the bottom
            float bottomFog = 1.0 - smoothstep(-0.5, 0.2, q.y + noise(q * 2.5 - totalTime) * 0.3);
            color = mix(color, fogColor, bottomFog * 0.65);

            // 4. Overlap & Color Fusion
            // Force colors to bleed into each other using noise tied to the dispersion phase
            float mergeNoise = noise(q * 3.0 + totalTime * 1.5);
            color = mix(color, sunColor, mergeNoise * mountAlpha * 0.35 * dispersion);

            // 5. Ambient Color Halos (色块色晕)
            // Replaced harsh mathematical grain with soft, breathing glowing fields
            float halo1 = 1.0 - smoothstep(0.0, 0.8, length(p - vec2(-0.35, -0.2) + vec2(sin(totalTime), cos(totalTime)) * 0.15));
            float halo2 = 1.0 - smoothstep(0.0, 0.9, length(p - vec2(0.4, 0.15) + vec2(cos(totalTime*0.8), sin(totalTime*0.9)) * 0.2));
            color = mix(color, sunColor, halo1 * 0.12);
            color = mix(color, fogColor, halo2 * 0.15);

            // Subtle mountain corona / bloom blending
            float bloom = 1.0 - smoothstep(0.0, 0.5, mountDist);
            color = mix(color, sunColor, bloom * 0.15 * (1.0 - mountAlpha));

            // Subtle Vignette
            float vignette = length(p) * 0.4;
            color -= vignette * 0.12;

            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
    `;

    function createBackground() {
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
        document.body.prepend(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const uniforms = {
            uTime: { value: 0 },
            uResolution: { value: new THREE.Vector2(1, 1) }
        };
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
                renderer.domElement.remove();
                document.body.classList.remove('three-bg-active');
            }
        };
    }

    function start() {
        try {
            global.SHUIThreeBackground = createBackground();
        } catch (error) {
            console.warn('[SHUI Three Background] fallback applied:', error);
            document.body.classList.add('three-bg-fallback');
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})(typeof window !== 'undefined' ? window : this);
