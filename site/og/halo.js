// Shared halo background for the OG banners: the same shader as the home hero, drawn once at a fixed moment.
// Each banner picks its own moment with <canvas data-t="..."> so the six cards do not look identical.
(function () {
  var canvas = document.getElementById('halo');
  var gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  var vert = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  var frag = [
    'precision highp float;',
    'uniform vec2 uRes; uniform float uTime;',
    'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= .5; } return v; }',
    'void main(){',
    '  vec2 frag = gl_FragCoord.xy; vec2 uv = frag / uRes; float asp = uRes.x / uRes.y;',
    '  vec2 p = (uv - vec2(.5, .5)) * vec2(asp, 1.); float t = uTime * .045;',
    '  vec2 q = vec2(fbm(p * 1.5 + vec2(0., t)), fbm(p * 1.5 + vec2(5.2, 1.3) - t));',
    '  vec2 r = vec2(fbm(p * 1.8 + q * 2. + vec2(1.7, 9.2) + t * 1.4), fbm(p * 1.8 + q * 2. + vec2(8.3, 2.8) - t));',
    '  float w = fbm(p * 1.2 + r * 1.6);',
    '  vec2 e = p * vec2(.5, 1.); float ang = atan(e.y, e.x);',
    '  float rad = length(e) + (w - .5) * .34 + (q.x - .5) * .1; float ring = abs(rad - .44);',
    '  float core = exp(-ring * ring * 34.); float bloom = exp(-ring * 4.2) * .22; float inner = smoothstep(.44, .0, rad) * .22;',
    '  vec3 bg = vec3(.082, .086, .094); vec3 navy = vec3(.07, .09, .25); vec3 deep = vec3(.247, .322, .851);',
    '  vec3 brand = vec3(.518, .592, .98); vec3 hi = vec3(.78, .82, 1.);',
    '  float side = .5 + .5 * cos(ang - .75);',
    '  vec3 tone = mix(deep, brand, smoothstep(.25, .9, w + .4 * (side - .5)));',
    '  float glow = core + bloom;',
    '  vec3 col = bg + navy * inner + tone * glow * .27 + hi * pow(core, 3.) * .11 * side;',
    '  float g = hash(frag) - .5; col += g * (.01 + .13 * clamp(glow, 0., 1.)) * vec3(.62, .72, 1.);',
    '  gl_FragColor = vec4(col, 1.);',
    '}'
  ].join('\n');
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), canvas.width, canvas.height);
  gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), parseFloat(canvas.dataset.t || '40'));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
})();
