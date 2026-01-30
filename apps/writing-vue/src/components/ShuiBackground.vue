<template>
  <canvas ref="canvasRef" class="shui-bg-canvas"></canvas>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const canvasRef = ref(null)
let gl = null
let animationFrameId = null
let program = null

// Shader Sources (From legacy shuiBackground.js)
const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
        v_uv = (a_position + 1.0) * 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`

const fragmentSource = `
    precision mediump float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform vec3 u_colorStart;
    uniform vec3 u_colorEnd;
    uniform vec3 u_colorMid;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) +
            (c - a) * u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
    }

    float fbm(vec2 p) {
        float total = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 5; i++) {
            total += noise(p) * amplitude;
            p *= 2.02;
            amplitude *= 0.5;
        }
        return total;
    }

    void main() {
        vec2 uv = v_uv * u_resolution.xy / min(u_resolution.x, u_resolution.y);
        // 加速流动：从 0.08 提升到 0.25
        float t = u_time * 0.25; 
        float n1 = fbm(uv * 0.8 + vec2(t * 0.25, t * -0.2));
        float n2 = fbm(uv * 1.3 - vec2(t * 0.3, t * 0.18));
        
        // 增强色块感：缩窄 smoothstep 的范围 (0.0, 1.0 -> 0.3, 0.7)
        float blend = smoothstep(0.3, 0.7, n1);
        
        vec3 base = mix(u_colorStart, u_colorEnd, blend);
        
        // 同样增强第二层噪声的对比度
        float accentBlend = smoothstep(0.4, 0.6, n2);
        vec3 accent = mix(base, u_colorMid, accentBlend * 0.65);
        
        gl_FragColor = vec4(accent, 1.0);
    }
`

// Helpers
function hexToRgbArray(hex, fallback) {
    const value = (hex || fallback || '').trim();
    if (!value) return [1, 1, 1];
    const normalized = value.replace(/^#/, '');
    const full = normalized.length === 3
        ? normalized.split('').map((c) => c + c).join('')
        : normalized;
    if (full.length !== 6) return [1, 1, 1];
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return [r / 255, g / 255, b / 255];
}

function mixColor(a, b, ratio) {
    return [
        a[0] + (b[0] - a[0]) * ratio,
        a[1] + (b[1] - a[1]) * ratio,
        a[2] + (b[2] - a[2]) * ratio
    ];
}

function getPalette() {
    const styles = window.getComputedStyle(document.documentElement);
    // 使用 CSS 变量或默认值
    const start = styles.getPropertyValue('--shui-gradient-start') || '#667eea'; 
    const end = styles.getPropertyValue('--shui-gradient-end') || '#764ba2';
    
    const startRgb = hexToRgbArray(start, '#667eea');
    const endRgb = hexToRgbArray(end, '#764ba2');
    const midRgb = mixColor(startRgb, endRgb, 0.5);
    return { start: startRgb, end: endRgb, mid: midRgb };
}

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexSrc, fragmentSrc) {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSrc);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
    if (!vertexShader || !fragmentShader) return null;
    
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

onMounted(() => {
    const canvas = canvasRef.value
    gl = canvas.getContext('webgl', {
        alpha: false, // 纯背景不需要 alpha
        antialias: true,
        premultipliedAlpha: false
    })

    if (!gl) return

    program = createProgram(gl, vertexSource, fragmentSource)
    if (!program) return

    // Buffer setup
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1
    ]), gl.STATIC_DRAW)

    const positionLocation = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    gl.useProgram(program)

    // Uniform locations
    const timeLocation = gl.getUniformLocation(program, 'u_time')
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
    const startColorLocation = gl.getUniformLocation(program, 'u_colorStart')
    const endColorLocation = gl.getUniformLocation(program, 'u_colorEnd')
    const midColorLocation = gl.getUniformLocation(program, 'u_colorMid')

    // Initial palette apply
    const applyPalette = () => {
        const palette = getPalette()
        gl.uniform3fv(startColorLocation, new Float32Array(palette.start))
        gl.uniform3fv(endColorLocation, new Float32Array(palette.end))
        gl.uniform3fv(midColorLocation, new Float32Array(palette.mid))
    }
    applyPalette()

    // Resize handler
    const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
        const width = window.innerWidth
        const height = window.innerHeight
        canvas.width = width * ratio
        canvas.height = height * ratio
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
    }
    window.addEventListener('resize', resize)
    resize()

    // Animation Loop
    let startTime = performance.now()
    const render = (now) => {
        const elapsed = (now - startTime) / 1000
        gl.uniform1f(timeLocation, elapsed)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        animationFrameId = requestAnimationFrame(render)
    }
    render(startTime)
})

onBeforeUnmount(() => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId)
    // Clean up WebGL resources if necessary
})
</script>

<style scoped>
.shui-bg-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: -1; /* 这里是 -1，但父级 app-container 必须透明 */
  pointer-events: none;
}
</style>
