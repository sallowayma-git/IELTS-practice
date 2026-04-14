<template>
  <div class="shui-bg-container" ref="container">
    <canvas ref="canvasEl" class="shui-bg-canvas"></canvas>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const container = ref(null)
const canvasEl = ref(null)
let gl = null
let program = null
let animationFrameId = null
let isPaused = false

const vertexSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

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
      float t = u_time * 0.08;
      float n1 = fbm(uv * 0.8 + vec2(t * 0.25, t * -0.2));
      float n2 = fbm(uv * 1.3 - vec2(t * 0.3, t * 0.18));
      float blend = smoothstep(0.0, 1.0, n1);
      vec3 base = mix(u_colorStart, u_colorEnd, blend);
      vec3 accent = mix(base, u_colorMid, n2 * 0.65);
      gl_FragColor = vec4(accent, 0.55);
  }
`;

function hexToRgbArray(hex, fallback) {
  const value = (hex || fallback || '').trim()
  if (!value) return [1, 1, 1]
  const normalized = value.replace(/^#/, '')
  const full = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized
  if (full.length !== 6) return [1, 1, 1]
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return [r / 255, g / 255, b / 255]
}

function mixColor(a, b, ratio) {
  return [
    a[0] + (b[0] - a[0]) * ratio,
    a[1] + (b[1] - a[1]) * ratio,
    a[2] + (b[2] - a[2]) * ratio
  ]
}

function getPalette() {
  const styles = window.getComputedStyle(document.documentElement)
  const start = styles.getPropertyValue('--shui-gradient-start') || '#ffd89b'
  const end = styles.getPropertyValue('--shui-gradient-end') || '#6accc7'
  const startRgb = hexToRgbArray(start, '#ffd89b')
  const endRgb = hexToRgbArray(end, '#6accc7')
  const midRgb = mixColor(startRgb, endRgb, 0.5)
  return { start: startRgb, end: endRgb, mid: midRgb }
}

function createShader(glContext, type, source) {
  const shader = glContext.createShader(type)
  glContext.shaderSource(shader, source)
  glContext.compileShader(shader)
  if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
    console.error(glContext.getShaderInfoLog(shader))
    glContext.deleteShader(shader)
    return null
  }
  return shader
}

const handleVisibility = () => {
  isPaused = document.hidden
}

onMounted(() => {
  if (!canvasEl.value) return
  
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReducedMotion) return

  gl = canvasEl.value.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false
  })

  if (!gl) return

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertexShader || !fragmentShader) return
  
  program = gl.createProgram()
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program))
    return
  }

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW)

  gl.useProgram(program)
  const positionLocation = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  const timeLocation = gl.getUniformLocation(program, 'u_time')
  const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
  const startColorLocation = gl.getUniformLocation(program, 'u_colorStart')
  const endColorLocation = gl.getUniformLocation(program, 'u_colorEnd')
  const midColorLocation = gl.getUniformLocation(program, 'u_colorMid')

  function applyPalette() {
    const palette = getPalette()
    gl.uniform3fv(startColorLocation, new Float32Array(palette.start))
    gl.uniform3fv(endColorLocation, new Float32Array(palette.end))
    gl.uniform3fv(midColorLocation, new Float32Array(palette.mid))
  }

  applyPalette()

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    const width = window.innerWidth
    const height = window.innerHeight
    if(canvasEl.value) {
      canvasEl.value.width = width * ratio
      canvasEl.value.height = height * ratio
      gl.viewport(0, 0, canvasEl.value.width, canvasEl.value.height)
      gl.uniform2f(resolutionLocation, canvasEl.value.width, canvasEl.value.height)
    }
  }

  resize()
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', handleVisibility)

  let startTime = performance.now()
  let lastFrameTime = 0
  const frameInterval = 1000 / 15 // smooth but efficient

  function render(now) {
    if (isPaused) {
      animationFrameId = window.requestAnimationFrame(render)
      return
    }
    if (now - lastFrameTime < frameInterval) {
      animationFrameId = window.requestAnimationFrame(render)
      return
    }
    lastFrameTime = now
    const elapsed = (now - startTime) / 1000
    gl.uniform1f(timeLocation, elapsed)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    animationFrameId = window.requestAnimationFrame(render)
  }

  animationFrameId = window.requestAnimationFrame(render)
})

onBeforeUnmount(() => {
  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId)
  }
  window.removeEventListener('resize', () => {})
  document.removeEventListener('visibilitychange', handleVisibility)
})
</script>

<style scoped>
.shui-bg-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: -1;
  pointer-events: none;
  background: var(--bg-app); /* fallback */
}

.shui-bg-canvas {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
