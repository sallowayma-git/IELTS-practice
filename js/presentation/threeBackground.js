(function initShuiThreeBackground(global) {
    'use strict';

    let themeIntentGeneration = 0;
    let pendingInitialBackground = null;

    function cancelInitialBackground() {
        if (!pendingInitialBackground) return;
        const pending = pendingInitialBackground;
        pendingInitialBackground = null;
        pending.cancel();
        if (global.SHUIThreeBackground === pending.controller) global.SHUIThreeBackground = null;
    }

    function startInitialBackgroundAfterPaint(themeName, generation) {
        if (!Object.hasOwn(shaders, themeName)
            || typeof global.requestAnimationFrame !== 'function' || typeof global.setTimeout !== 'function') {
            start(themeName);
            return;
        }
        let frameId = null;
        let timerId = null;
        const controller = {
            refresh() {},
            destroy() {
                themeIntentGeneration += 1;
                cancelInitialBackground();
            }
        };
        const pending = {
            controller,
            cancel() {
                if (frameId !== null) global.cancelAnimationFrame(frameId);
                if (timerId !== null) global.clearTimeout(timerId);
            }
        };
        pendingInitialBackground = pending;
        // Keep cancellation available while the optional renderer waits for a
        // painted shell. Explicit theme switches remain immediate.
        global.SHUIThreeBackground = controller;
        const initializeRenderer = () => {
            if (pendingInitialBackground !== pending) return;
            if (themeIntentGeneration !== generation || global.SHUIThreeBackground !== controller) {
                cancelInitialBackground();
                return;
            }
            pendingInitialBackground = null;
            global.SHUIThreeBackground = null;
            start(themeName);
        };
        if (document.hidden) {
            timerId = global.setTimeout(initializeRenderer, 0);
        } else {
            frameId = global.requestAnimationFrame(() => {
                frameId = null;
                // Constructing a WebGL context and its shader is substantial
                // synchronous work; perform it after the frame can paint.
                timerId = global.setTimeout(initializeRenderer, 0);
            });
        }
    }

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

    };

    function createBackground(theme = 'misty-mountain') {
        const THREE = global.THREE;
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
            depth: false,
            stencil: false,
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
        
        const fragmentShader = shaders[theme];

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
        let destroyed = false;
        const motionQuery = typeof global.matchMedia === 'function'
            ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
        const startedAt = performance.now();
        const frameInterval = 1000 / 24;

        function canAnimate() {
            return !destroyed && !document.hidden && !(motionQuery && motionQuery.matches);
        }

        function scheduleFrame() {
            if (!rafId && canAnimate()) rafId = global.requestAnimationFrame(render);
        }

        function resize() {
            const width = Math.max(1, global.innerWidth || 1);
            const height = Math.max(1, global.innerHeight || 1);
            // This soft, decorative shader shares the GPU with the glass UI.
            const scale = Math.min(1, Math.sqrt(1_250_000 / (width * height)));
            const renderWidth = Math.max(1, Math.floor(width * scale));
            const renderHeight = Math.max(1, Math.floor(height * scale));
            renderer.setSize(renderWidth, renderHeight, false);
            uniforms.uResolution.value.set(renderWidth, renderHeight);
            render(performance.now(), true);
        }

        function render(now, force) {
            if (!force) rafId = 0;
            if (destroyed || (!force && !canAnimate())) return;
            if (!force && now - lastFrame < frameInterval) {
                scheduleFrame();
                return;
            }
            lastFrame = now;
            uniforms.uTime.value = (now - startedAt) / 1000;
            renderer.render(scene, camera);
            if (!force) scheduleFrame();
        }

        function handleVisibility() {
            if (rafId) {
                global.cancelAnimationFrame(rafId);
                rafId = 0;
            }
            if (!document.hidden) {
                render(performance.now(), true);
                scheduleFrame();
            }
        }

        resize();
        global.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', handleVisibility);
        if (motionQuery && typeof motionQuery.addEventListener === 'function') {
            motionQuery.addEventListener('change', handleVisibility);
        }
        scheduleFrame();

        document.body.classList.add('three-bg-active');

        return {
            renderer,
            refresh: () => render(performance.now(), true),
            destroy() {
                destroyed = true;
                if (rafId) {
                    global.cancelAnimationFrame(rafId);
                    rafId = 0;
                }
                global.removeEventListener('resize', resize);
                document.removeEventListener('visibilitychange', handleVisibility);
                if (motionQuery && typeof motionQuery.removeEventListener === 'function') {
                    motionQuery.removeEventListener('change', handleVisibility);
                }
                renderer.dispose();
                material.dispose();
                mesh.geometry.dispose();
                if (renderer.domElement.parentNode) {
                    renderer.domElement.remove();
                }
            }
        };
    }

    const ASCII_FLOWER_LINES = [
      [0, ""],
      [0, ""],
      [0, ""],
      [0, ""],
      [0, ""],
      [23, "':l:;."],
      [21, "..,;;;;:."],
      [18, "..;c::::;:::                                      .;,:c,;;:clcl,."],
      [15, "..,''',;;,;,,;::,.                              ..;;;;:;;;;;;:;;::;;.  .."],
      [14, ".'';;;;:;:;::cclcc'..                         .,;ccc:::c::::c:lcc:c:cc;;cc;;,"],
      [13, "'..','',,',':;ccc::,...                       ';:;;;;,;;:,,;,::c::;:;c:c,,,'''."],
      [12, "....,,,'',,:;:;:cc:::....'''.                 .;,;;;;;';;c::c,;::,;;,;c;:'..',;;"],
      [10, "'..'..',;;;c;::c:cclloll;;lc:cc',..           .l:c:c::cc:::l::;,;;;',;;:;;ccoooodl'."],
      [10, "..'''',,,;;:;'':;::::cccccc:,;;,;';;;,.      ';:;;,;;:::,,','',','',;',;:;:;::;;;;,;."],
      [9, ".,,,;,,,;:::::,',,:;:;cll:;;:'...,;c;;,'..   .'',''.,,,,;',','''',,;''';;;,::cc::;;,,'........"],
      [9, "..'','',;',;:;'',''',,::,,,,;,,;,,,:;;.....  ......',''',.'.'..'';':;;,:.'''.,;,;;;;::,',,,',''."],
      [9, ".,,,;,';::,,:,;,:,;,,,:c;;::::cc,:,;,;;;;:;,'cc,,.,;:;;;;,;,:,;;,:locc;c;;:lcllllollollcccc::;;''"],
      [11, "... ..'.'',''',''''.;;;;::;:::',''.,''',,'':;,,.'',''',.'',,,',:::;;;,,';c:::::::;:::;;;;,;''.."],
      [12, "....',''',,,',',,,';clccc:ccl;,';;ccc::;;:llcc:c',''',',';':c:ccl:ccc,cllccccclcclc:;,,,';'',."],
      [14, "..';,,,;;;,:,;;:colllccclll::;llllllllllollollll:;;:,cclccc:c;lclcl;lllcccccllclllcl,,',''..."],
      [16, "..''',''.,.,:llllcccccccc::;ccc:ccccccclcllocc::;;;::c::ccc,:cc;;;ccc,:::lllccc::,........."],
      [18, ".'',,'',',:::;;;:::cc:c:c::c:::ccccccccclccc:c::;ccc:c:;:,:c:;;;:;,;::::::;:::.........."],
      [19, "..'''',.,c;;:::clcclcl:lccclcccclccllloolclllllcccc:cc:c;lc,;;;;',:c:,;cc:c:,....."],
      [19, ".::,,,;,;;;;cclllllccllolllllclllllollllolllcclclclc:cccco:::l;;,:;:c:ccc:c;'..."],
      [10, ".         .,''.'.'''';;::::;c:::::::cc:::cc::::cclcc,',;;;;:;,,',;:';,:.'''.;';;;;,;'..."],
      [8, ".;lll:       ';:,;,;;;,lllclcclllclllclllllllclllollc:,;,;:c;:,lc,;cc:;c:',,;,,;::cc:;..."],
      [7, ".,,;,:;        .'';',,,'::cc:ccccc:lccccccccc::lclc::',,,',.,',',,';;,,;:,''''.;;;:::'...."],
      [6, ".,;,;,;:,.....    .,,:,,;ccccccclcl:lllclllllc;cllll,,,,;,',.'.,'','c;:'l:,.,';;cc::'....."],
      [6, ",,,.;.',;:::,,..     ..,'::;:c::c:c;ccccc:ccc,ccclc:',,;''.....,',',,,;::''.',:;:;......."],
      [5, ".:,...'',:c:ccc::;;,,'';;,;:::cccccc:cccccccc:ccclcc:,;,;''',''.,'';;,;cc;',',:c;,'....."],
      [6, ";,'.;::lccclllollllcclcc:c::::::ccc:c:cccc::cccclccl;,,;''';',';',:',;l;'',;::,......"],
      [6, ",,;':;lollllllllllllclllcc::;;';::c;::c:cc::c::ccccl:,''.'''.'.'.;,.,:c''',,'......"],
      [7, ";:;c:lol:llooolclcllllllllcc::;;,;;;;c:ccc:cccclcc:,,';',,;,,,:;,;,c:,',,........"],
      [8, ";:::::...;;;:ccc:cclllcc::::;''''.,';;:;:,:::;:;',',','.',.'';.';,;''........"],
      [8, "';:,. .....''..,''.';c;cc;;;;,,,;,;,,,ccc,;cc:;,;;,;,,',';':,;;:c;;'......        ''.."],
      [15, "'....    ......''''','''''.'.'.',;,,''.''.'''.''..;';':;,,''.....         ......"],
      [15, "...             ....',''''.,''.'',,;,,,,'',',;c;::::c:c,;;''';,;,,''''',;;;::,;;;."],
      [31, "...........'...'...'',.''.,,,,,.'';;;;:cccc:::;;,;;:::,;,';::;:::."],
      [33, "..''',,,',',',''','',,'';',',,:ccloddool;'''';;:;clocllllolllll.....'.,."],
      [35, "...'''.'.'.'.''''..'..'.,,;;:::::c:,',,;,,.'.,'::c:ccccccccc;,;'..',;;."],
      [37, "..',',.'.'';;'',,,'',''',''',,,,;;;;;;,'.'',',;cloollllllllllclllc:cc."],
      [40, "..'...;;;;:';::'''.'.'''''''','''''.'...'.'',':c:ccc:c::;:;,,:;cc;.."],
      [42, ". ..,,:::;;;c,.''..'.......'................''.,;,''',',''.,,'...."],
      [44, ".'::::c:::cc',''.'.'''.'.'..'.'.....'.'.'.'..'''',,;;c:'......."],
      [39, ".. . .;cc::c:c:c:;,',.'..',''.'..'.'.....'.'.'.''''''',,:c;'..."],
      [38, "..    .;cc::cc:;;;;;,,,'''',',','''.'''''''.'''''''',,,:,,...."],
      [44, ".',,'.,,''''',.''........'...................';;'....."],
      [37, ".      .;c;:';;;,;,,;',,,',',';,;,,,',,,'',,',,,',,',l:...."],
      [37, ".       .;...'''.'..'.'.'......';;:;,,''.....'''.,,';;...."],
      [36, "..        ''...'''''.'''.'.'''....';:;:;;..''.'.''''.;...."],
      [47, "....,..'..'.'.'.'''...'..,'::c;:::;::c:c:....."],
      [35, "..           ..'';,,,',''',.'';',',.''.',::cclcllo:;'..."],
      [34, ".                ...,,',''.'.'',,,,:;:;,;,:;;,,''......"],
      [33, ".                    .';:'',,.;;;,;;:;::;c:'......"],
      [56, ".',;;:clclcl:c::::,....."],
      [33, ".                           .....''........."],
      [32, "."],
      [0, ""],
      [31, ".."],
      [31, "."],
      [31, "."],
      [0, ""],
      [31, ".."],
      [0, ""],
      [0, ""],
      [0, ""],
      [29, "."],
      [29, "."],
      [0, ""],
      [29, "."],
      [29, "."],
      [0, ""],
      [0, ""],
      [0, ""],
      [0, ""],
      [0, ""]
    ];

    function renderAsciiFlower() {
        const container = document.querySelector('.ascii-bg-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        const wrapper = document.createElement('div');
        wrapper.className = 'ascii-flower-wrapper';
        
        wrapper.style.position = 'absolute';
        wrapper.style.fontFamily = '"Courier New", Courier, monospace';
        wrapper.style.fontSize = '11px';
        wrapper.style.lineHeight = '11.5px';
        wrapper.style.fontWeight = '600';
        wrapper.style.color = '#f4f4f5';
        wrapper.style.opacity = '0.75';
        wrapper.style.pointerEvents = 'none';
        wrapper.style.userSelect = 'none';
        
        const charWidth = 6.0;
        const rowHeight = 11.5;
        
        ASCII_FLOWER_LINES.forEach((line, index) => {
            if (!line[1]) return;
            const lineDiv = document.createElement('div');
            lineDiv.className = 'ascii-line';
            lineDiv.style.position = 'absolute';
            lineDiv.style.whiteSpace = 'pre';
            lineDiv.style.top = (index * rowHeight) + 'px';
            lineDiv.style.left = (line[0] * charWidth) + 'px';
            lineDiv.textContent = line[1];
            wrapper.appendChild(lineDiv);
        });
        
        container.appendChild(wrapper);
    }

    function start(themeName) {
        cancelInitialBackground();
        if (!Object.hasOwn(shaders, themeName) && themeName !== 'newjeans' && themeName !== 'ascii-flower') {
            themeName = 'floral-bloom';
        }
        document.body.setAttribute('data-bg-theme', themeName);
        document.body.classList.remove('three-bg-active', 'three-bg-fallback');
        const asciiContainer = document.querySelector('.ascii-bg-container');
        if (asciiContainer) asciiContainer.replaceChildren();

        global.SHUIThreeBackground?.destroy();
        global.SHUIThreeBackground = null;
        if (themeName === 'ascii-flower') renderAsciiFlower();
        if (!Object.hasOwn(shaders, themeName) || !global.WebGLRenderingContext) return;

        const generation = themeIntentGeneration;
        const applyRenderer = () => {
            if (themeIntentGeneration === generation) {
                global.SHUIThreeBackground = createBackground(themeName);
            }
        };
        const showFallback = error => {
            if (themeIntentGeneration !== generation) return;
            console.warn('[SHUI Three Background] fallback applied:', error);
            document.body.classList.add('three-bg-fallback');
        };
        try {
            if (global.THREE) {
                applyRenderer();
            } else {
                return global.AppLazyLoader.ensureGroup('theme-background').then(applyRenderer).catch(showFallback);
            }
        } catch (error) {
            showFallback(error);
        }
    }

    global.switchBgTheme = function(themeName) {
        themeIntentGeneration += 1;
        if (global.AppData && global.AppData.preferences) {
            global.AppData.preferences.setThreeBackground(themeName).catch((error) => console.warn('[SHUI Three Background] preference save failed:', error));
        }
        return start(themeName);
    };

    async function init() {
        if (themeIntentGeneration > 0) return;
        const generation = themeIntentGeneration;
        let saved = 'floral-bloom';
        try {
            await global.AppData.ready;
            saved = await global.AppData.preferences.getThreeBackground() || 'floral-bloom';
        } catch (_) { }
        // A theme selected while preferences load is newer than this startup
        // read, including when that read fails and falls back to the default.
        if (generation === themeIntentGeneration) startInitialBackgroundAfterPaint(saved, generation);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', () => init(), { once: true });
    }
})(typeof window !== 'undefined' ? window : this);
