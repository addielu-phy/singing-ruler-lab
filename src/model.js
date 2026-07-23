export const BETA_ROOTS = Object.freeze([
  1.875104068711961,
  4.694091132974174,
  7.854757438237612,
  10.995540734875467,
]);

// Q_n = ∫₀¹(φ′_n)²du / ∫₀¹φ_n²du for exact Euler–Bernoulli cantilever modes.
// The EB shapes serve as Rayleigh–Ritz trial functions when rotary inertia is
// added. This is an approximation, not the exact Rayleigh-beam eigenproblem.
export const ROTARY_RAYLEIGH_Q = Object.freeze([
  4.647778318679,
  32.417399027969,
  77.298890802295,
  142.901848835370,
]);

export const MATERIALS = Object.freeze({
  stainless: Object.freeze({
    label: '不鏽鋼（示例）',
    youngPa: 193e9,
    densityKgM3: 8000,
    color: '#4f6673',
  }),
  acrylic: Object.freeze({
    label: '壓克力（示例塑膠）',
    youngPa: 3.2e9,
    densityKgM3: 1180,
    color: '#e96b74',
  }),
  wood: Object.freeze({
    label: '木材（示例，方向相關）',
    youngPa: 11e9,
    densityKgM3: 650,
    color: '#b47a42',
  }),
});

const positive = (value, name) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} 必須是正數`);
  }
  return value;
};

export function rectangularSection(widthM, thicknessM) {
  positive(widthM, '寬度');
  positive(thicknessM, '厚度');
  return {
    areaM2: widthM * thicknessM,
    inertiaM4: widthM * thicknessM ** 3 / 12,
  };
}

function normalizedMode(mode) {
  const index = Math.round(Number(mode)) - 1;
  if (index < 0 || index >= BETA_ROOTS.length) {
    throw new RangeError('模態必須介於1與4');
  }
  return { index, beta: BETA_ROOTS[index] };
}

export function eulerBernoulliFrequency({
  lengthM,
  widthM,
  thicknessM,
  youngPa,
  densityKgM3,
  mode = 1,
}) {
  positive(lengthM, '有效長度');
  positive(youngPa, '楊氏係數');
  positive(densityKgM3, '密度');
  const { areaM2, inertiaM4 } = rectangularSection(widthM, thicknessM);
  const { beta } = normalizedMode(mode);
  return beta ** 2 / (2 * Math.PI * lengthM ** 2)
    * Math.sqrt(youngPa * inertiaM4 / (densityKgM3 * areaM2));
}

export function rayleighRitzFrequency(state) {
  const eb = eulerBernoulliFrequency(state);
  const { index } = normalizedMode(state.mode ?? 1);
  const ratio = positive(state.thicknessM, '厚度') / positive(state.lengthM, '有效長度');
  return eb / Math.sqrt(1 + ROTARY_RAYLEIGH_Q[index] * ratio ** 2 / 12);
}

export function frequencySeries(state, model = 'eb') {
  return BETA_ROOTS.map((_, index) => {
    const next = { ...state, mode: index + 1 };
    return model === 'rotary-ritz' ? rayleighRitzFrequency(next) : eulerBernoulliFrequency(next);
  });
}

export function tipStiffness({ lengthM, widthM, thicknessM, youngPa }) {
  positive(lengthM, '有效長度');
  positive(youngPa, '楊氏係數');
  const { inertiaM4 } = rectangularSection(widthM, thicknessM);
  return 3 * youngPa * inertiaM4 / lengthM ** 3;
}

export function staticTipDeflection({ forceN, ...beam }) {
  if (!Number.isFinite(forceN)) throw new RangeError('作用力必須是有限值');
  return forceN / tipStiffness(beam);
}

export function tipForceForDeflection({ displacementM, ...beam }) {
  if (!Number.isFinite(displacementM)) throw new RangeError('位移必須是有限值');
  return displacementM * tipStiffness(beam);
}

function rawModeShape(xRatio, beta) {
  const x = Math.min(1, Math.max(0, Number(xRatio)));
  const sigma = (Math.cosh(beta) + Math.cos(beta))
    / (Math.sinh(beta) + Math.sin(beta));
  return Math.cosh(beta * x) - Math.cos(beta * x)
    - sigma * (Math.sinh(beta * x) - Math.sin(beta * x));
}

export function cantileverModeShape(xRatio, mode = 1) {
  const { beta } = normalizedMode(mode);
  const end = rawModeShape(1, beta);
  return rawModeShape(xRatio, beta) / end;
}

export function modelSnapshot(state) {
  const {
    lengthM,
    widthM,
    thicknessM,
    youngPa,
    densityKgM3,
    mode = 1,
    amplitudeM = 0,
    dampingRatio = 0,
    model = 'eb',
  } = state;
  const { areaM2, inertiaM4 } = rectangularSection(widthM, thicknessM);
  const ebFrequencyHz = eulerBernoulliFrequency(state);
  const ritzFrequencyHz = rayleighRitzFrequency(state);
  const frequencyHz = model === 'rotary-ritz' ? ritzFrequencyHz : ebFrequencyHz;
  const angularFrequencyRadS = 2 * Math.PI * frequencyHz;
  const massKg = densityKgM3 * areaM2 * lengthM;
  const stiffness = tipStiffness(state);
  const { beta, index } = normalizedMode(mode);
  const ebSlopeHzM2 = ebFrequencyHz * lengthM ** 2;
  return {
    beta,
    areaM2,
    inertiaM4,
    frequencyHz,
    ebFrequencyHz,
    ritzFrequencyHz,
    rotaryCoefficientQ: ROTARY_RAYLEIGH_Q[index],
    correctionPercent: (1 - ritzFrequencyHz / ebFrequencyHz) * 100,
    angularFrequencyRadS,
    periodMs: 1000 / frequencyHz,
    ebSlopeHzM2,
    ebSlopeHzCm2: ebSlopeHzM2 * 1e4,
    // Backward-compatible names: slope always means the EB L^-2 law.
    slopeHzM2: ebSlopeHzM2,
    slopeHzCm2: ebSlopeHzM2 * 1e4,
    tipStiffnessNPerM: stiffness,
    tipForceN: tipForceForDeflection({ ...state, displacementM: amplitudeM }),
    massKg,
    linearMassKgM: densityKgM3 * areaM2,
    slenderness: lengthM / thicknessM,
    amplitudeRatio: amplitudeM / lengthM,
    decayTimeS: dampingRatio > 0 ? 1 / (dampingRatio * angularFrequencyRadS) : Infinity,
    seriesHz: frequencySeries(state, model),
  };
}
