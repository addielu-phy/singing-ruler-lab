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

const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${name} 必須是有限數值`);
  }
  return value;
};

const nonNegative = (value, name) => {
  finite(value, name);
  if (value < 0) throw new RangeError(`${name} 不得為負數`);
  return value === 0 ? 0 : value;
};

const normalizedModel = (model) => {
  if (model !== 'eb' && model !== 'rotary-ritz') {
    throw new RangeError('梁模型必須是eb或rotary-ritz');
  }
  return model;
};

const stateObject = (state) => {
  let invalid;
  try {
    invalid = typeof state !== 'object' || state === null || Array.isArray(state);
  } catch {
    throw new RangeError('模型狀態無法安全檢查');
  }
  if (invalid) {
    throw new RangeError('模型狀態必須是非null物件');
  }
  return state;
};

const STATE_FIELDS = Object.freeze([
  'lengthM', 'widthM', 'thicknessM', 'youngPa', 'densityKgM3',
  'mode', 'amplitudeM', 'dampingRatio', 'model', 'forceN', 'displacementM',
]);

const stateSnapshot = (state) => {
  stateObject(state);
  const snapshot = {};
  for (const key of STATE_FIELDS) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(state, key);
    } catch {
      throw new RangeError('模型狀態欄位無法安全讀取');
    }
    if (descriptor && !Object.hasOwn(descriptor, 'value')) {
      throw new RangeError(`模型狀態欄位${key}必須是資料屬性`);
    }
    snapshot[key] = descriptor?.value;
  }
  return Object.freeze(snapshot);
};

const MIN_NORMAL = 2 ** -1022;
const NORMAL_SAFETY_FLOOR = MIN_NORMAL * (1 + 32 * Number.EPSILON);

const positiveDerived = (value, name) => {
  positive(value, name);
  if (value <= NORMAL_SAFETY_FLOOR) {
    throw new RangeError(`${name}發生浮點下溢`);
  }
  return value;
};

const finiteDerived = (value, source, name) => {
  finite(value, name);
  if (source !== 0 && (value === 0 || Math.abs(value) <= NORMAL_SAFETY_FLOOR)) {
    throw new RangeError(`${name}發生浮點下溢`);
  }
  return value;
};

export function rectangularSection(widthM, thicknessM) {
  positive(widthM, '寬度');
  positive(thicknessM, '厚度');
  const areaM2 = widthM * thicknessM;
  const inertiaM4 = widthM * thicknessM ** 3 / 12;
  return Object.freeze({
    areaM2: positiveDerived(areaM2, '截面面積計算結果'),
    inertiaM4: positiveDerived(inertiaM4, '截面二次矩計算結果'),
  });
}

function normalizedMode(mode) {
  if (typeof mode !== 'number' || !Number.isInteger(mode) || mode < 1 || mode > BETA_ROOTS.length) {
    throw new RangeError('模態必須是1至4的整數');
  }
  const index = mode - 1;
  return { index, beta: BETA_ROOTS[index] };
}

export function eulerBernoulliFrequency(state) {
  const {
    lengthM,
    widthM,
    thicknessM,
    youngPa,
    densityKgM3,
    mode = 1,
  } = stateSnapshot(state);
  positive(lengthM, '有效長度');
  positive(youngPa, '楊氏係數');
  positive(densityKgM3, '密度');
  const { areaM2, inertiaM4 } = rectangularSection(widthM, thicknessM);
  const { beta } = normalizedMode(mode);
  const frequencyHz = beta ** 2 / (2 * Math.PI * lengthM ** 2)
    * Math.sqrt(youngPa * inertiaM4 / (densityKgM3 * areaM2));
  return positiveDerived(frequencyHz, 'Euler–Bernoulli頻率計算結果');
}

export function rayleighRitzFrequency(state) {
  const beam = stateSnapshot(state);
  const eb = eulerBernoulliFrequency(beam);
  const { index } = normalizedMode(beam.mode ?? 1);
  const ratio = positiveDerived(
    positive(beam.thicknessM, '厚度') / positive(beam.lengthM, '有效長度'),
    '厚長比計算結果',
  );
  const rotaryTerm = positiveDerived(ROTARY_RAYLEIGH_Q[index] * ratio ** 2 / 12, 'Rayleigh–Ritz轉動修正量');
  const denominator = positive(Math.sqrt(1 + rotaryTerm), 'Rayleigh–Ritz修正分母');
  if (denominator === 1) throw new RangeError('Rayleigh–Ritz修正小於可表示範圍');
  return positiveDerived(eb / denominator, 'Rayleigh–Ritz頻率計算結果');
}

export function frequencySeries(state, model = 'eb') {
  const beam = stateSnapshot(state);
  const selectedModel = normalizedModel(model);
  return Object.freeze(BETA_ROOTS.map((_, index) => {
    const next = { ...beam, mode: index + 1 };
    return selectedModel === 'rotary-ritz' ? rayleighRitzFrequency(next) : eulerBernoulliFrequency(next);
  }));
}

export function tipStiffness(state) {
  const {
    lengthM, widthM, thicknessM, youngPa,
  } = stateSnapshot(state);
  positive(lengthM, '有效長度');
  positive(youngPa, '楊氏係數');
  const { inertiaM4 } = rectangularSection(widthM, thicknessM);
  return positiveDerived(3 * youngPa * inertiaM4 / lengthM ** 3, '端點剛性計算結果');
}

export function staticTipDeflection(state) {
  const { forceN, ...beam } = stateSnapshot(state);
  finite(forceN, '作用力');
  const result = finiteDerived(forceN / tipStiffness(beam), forceN, '端點位移計算結果');
  return result === 0 ? 0 : result;
}

export function tipForceForDeflection(state) {
  const { displacementM, ...beam } = stateSnapshot(state);
  finite(displacementM, '位移');
  const result = finiteDerived(displacementM * tipStiffness(beam), displacementM, '端點作用力計算結果');
  return result === 0 ? 0 : result;
}

function rawModeShape(x, beta) {
  const sigma = (Math.cosh(beta) + Math.cos(beta))
    / (Math.sinh(beta) + Math.sin(beta));
  const z = beta * x;
  return Math.cosh(z) - Math.cos(z)
    - sigma * (Math.sinh(z) - Math.sin(z));
}

export function cantileverModeShape(xRatio, mode = 1) {
  finite(xRatio, '無因次位置');
  const x = Math.min(1, Math.max(0, xRatio));
  const { beta, index } = normalizedMode(mode);
  const end = rawModeShape(1, beta);
  const z = beta * x;
  let result;
  if (Math.abs(z) < 1e-2) {
    const sigma = (Math.cosh(beta) + Math.cos(beta))
      / (Math.sinh(beta) + Math.sin(beta));
    const z2 = z * z;
    const z4 = z2 * z2;
    const z8 = z4 * z4;
    const factor = 1 - sigma * z / 3
      + z4 / 360 - sigma * z4 * z / 2520
      + z8 / 1814400 - sigma * z8 * z / 19958400;
    const endpointSign = index % 2 === 0 ? 1 : -1;
    const normalizedLeading = endpointSign * (z / Math.SQRT2) ** 2;
    result = normalizedLeading * factor;
  } else {
    result = rawModeShape(x, beta) / end;
  }
  return finiteDerived(result, x, '模態形狀計算結果');
}

export function modelSnapshot(state) {
  const beam = stateSnapshot(state);
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
  } = beam;
  const selectedModel = normalizedModel(model);
  nonNegative(amplitudeM, '釋放位移');
  nonNegative(dampingRatio, '阻尼比');
  const { areaM2, inertiaM4 } = rectangularSection(widthM, thicknessM);
  const ebFrequencyHz = eulerBernoulliFrequency(beam);
  const ritzFrequencyHz = rayleighRitzFrequency(beam);
  const frequencyHz = selectedModel === 'rotary-ritz' ? ritzFrequencyHz : ebFrequencyHz;
  const angularFrequencyRadS = positiveDerived(2 * Math.PI * frequencyHz, '角頻率計算結果');
  const massKg = positiveDerived(densityKgM3 * areaM2 * lengthM, '質量計算結果');
  const stiffness = tipStiffness(beam);
  const { beta, index } = normalizedMode(mode);
  const ebSlopeHzM2 = positiveDerived(ebFrequencyHz * lengthM ** 2, '頻率斜率計算結果');
  const correctionPercent = positiveDerived((1 - ritzFrequencyHz / ebFrequencyHz) * 100, '修正百分比計算結果');
  const periodMs = positiveDerived(1000 / frequencyHz, '週期計算結果');
  const ebSlopeHzCm2 = positiveDerived(ebSlopeHzM2 * 1e4, '公分制頻率斜率計算結果');
  const tipForceN = finite(tipForceForDeflection({ ...beam, displacementM: amplitudeM }), '端點作用力計算結果');
  const linearMassKgM = positiveDerived(densityKgM3 * areaM2, '線密度計算結果');
  const slenderness = positiveDerived(lengthM / thicknessM, '細長比計算結果');
  const amplitudeRatio = nonNegative(
    finiteDerived(amplitudeM / lengthM, amplitudeM, '振幅比計算結果'),
    '振幅比計算結果',
  );
  const decayTimeS = dampingRatio > 0
    ? positiveDerived(1 / (dampingRatio * angularFrequencyRadS), '衰減時間計算結果')
    : null;
  const seriesHz = frequencySeries(beam, selectedModel);
  return Object.freeze({
    beta,
    areaM2,
    inertiaM4,
    frequencyHz,
    ebFrequencyHz,
    ritzFrequencyHz,
    rotaryCoefficientQ: ROTARY_RAYLEIGH_Q[index],
    correctionPercent,
    angularFrequencyRadS,
    periodMs,
    ebSlopeHzM2,
    ebSlopeHzCm2,
    // Backward-compatible names: slope always means the EB L^-2 law.
    slopeHzM2: ebSlopeHzM2,
    slopeHzCm2: ebSlopeHzCm2,
    tipStiffnessNPerM: stiffness,
    tipForceN,
    massKg,
    linearMassKgM,
    slenderness,
    amplitudeRatio,
    decayTimeS,
    seriesHz,
  });
}
