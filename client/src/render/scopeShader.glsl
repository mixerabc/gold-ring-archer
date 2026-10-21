// GOLD RING — compound scope lens shader.
//
// Renders the magnified scope view (a second camera's render target) inside the
// eyepiece circle: reticle, level bubble, lens vignette and a touch of
// chromatic aberration at the edge of the glass.
//
// The plane using this material is a child of the first-person camera with
// depth testing disabled, so it always sits on top of the bow and the target.

uniform sampler2D tDiffuse;
uniform float uMagnification;
uniform float uCant;
uniform float uBubbleOffset;
uniform vec3 uReticleColor;
uniform float uTime;
uniform float uLensRadius;
uniform float uShowReticle;

varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);

  // Soft edge of the eyepiece: outside it the lens is transparent so the bow
  // and the world remain visible around the scope.
  float mask = smoothstep(uLensRadius, uLensRadius - 0.02, r);
  if (mask <= 0.001) discard;

  // Magnified sample: 1.0 = same field of view, 4.0 = 4x.
  vec2 uv = p / uMagnification * 0.5 + 0.5;

  // A little chromatic aberration towards the rim, like a real lens.
  float ca = 0.0016 * smoothstep(0.35, 1.0, r);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;

  // Reticle: a fine cross with a centre gap and a dot.
  vec2 q = abs(p);
  float thickness = 0.0045;
  float gap = 0.035;
  float cross = 0.0;
  if (uShowReticle > 0.5) {
    cross += step(q.y, thickness) * step(gap, q.x) * step(q.x, 0.62);
    cross += step(q.x, thickness) * step(gap, q.y) * step(q.y, 0.62);
    cross += step(length(p), 0.0075);
  }
  col = mix(col, uReticleColor, clamp(cross, 0.0, 1.0) * 0.92);

  // Level bubble: a small tube at the bottom of the lens. The bubble slides
  // with the cant angle, exactly like the spirit level on a scope.
  float tubeY = -0.66;
  float inTube = step(abs(p.y - tubeY), 0.022) * step(abs(p.x), 0.2);
  float tubeEdge = step(abs(p.y - tubeY), 0.026) * step(abs(p.x), 0.206);
  col = mix(col, vec3(0.82, 0.86, 0.9), tubeEdge * 0.35);
  float bubbleX = clamp(uBubbleOffset, -0.15, 0.15);
  float bubble = step(length(vec2(p.x - bubbleX, p.y - tubeY)), 0.017);
  col = mix(col, vec3(0.35, 0.95, 0.65), bubble * inTube * 0.9);
  float centreMark = step(abs(p.x), 0.004) * step(abs(p.y - tubeY), 0.026) * inTube;
  col = mix(col, vec3(0.1, 0.12, 0.14), centreMark * 0.7);

  // Lens vignette and a faint blue-green coating tint at the rim.
  float vig = smoothstep(uLensRadius * 0.45, uLensRadius, r);
  col *= 1.0 - vig * 0.6;
  col += vec3(0.02, 0.05, 0.06) * vig;

  // Dust / micro scratches, static in lens space.
  float dust = fract(sin(dot(floor(p * 220.0), vec2(12.9898, 78.233))) * 43758.5453);
  col *= 1.0 - step(0.9965, dust) * 0.25;

  gl_FragColor = vec4(col, mask);
}
