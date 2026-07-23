import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BETA_ROOTS,
  ROTARY_RAYLEIGH_Q,
  rectangularSection,
  eulerBernoulliFrequency,
  rayleighRitzFrequency,
  frequencySeries,
  tipStiffness,
  staticTipDeflection,
  tipForceForDeflection,
  cantileverModeShape,
  modelSnapshot,
} from '../src/model.js';

const close = (actual, expected, rel = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${actual} ≈ ${expected}`);
};

const base = {
  lengthM: 0.06,
  widthM: 0.03,
  thicknessM: 0.0005,
  youngPa: 193e9,
  densityKgM3: 8000,
  mode: 1,
};

test('cantilever roots satisfy cosh(beta) cos(beta) + 1 = 0', () => {
  assert.equal(BETA_ROOTS.length, 4);
  for (const beta of BETA_ROOTS) {
    assert.ok(Math.abs(Math.cosh(beta) * Math.cos(beta) + 1) < 1e-8);
  }
});

test('rectangular section uses A = bh and I = bh^3/12', () => {
  const { areaM2, inertiaM4 } = rectangularSection(0.03, 0.0005);
  close(areaM2, 1.5e-5);
  close(inertiaM4, 3.125e-13);
});

test('default stainless-steel worked example is locked', () => {
  const f = eulerBernoulliFrequency(base);
  close(f, 110.19995712568767, 1e-12);
  const snapshot = modelSnapshot({ ...base, amplitudeM: 0.01, dampingRatio: 0.012 });
  close(snapshot.periodMs, 9.074413693822567, 1e-12);
  close(snapshot.slopeHzCm2, 3967.1984565247562, 1e-12);
  close(snapshot.tipStiffnessNPerM, 837.6736111111112, 1e-12);
  close(snapshot.massKg, 0.0072, 1e-12);
  close(modelSnapshot({ ...base, amplitudeM: 0.005 }).tipForceN, 4.188368055555556, 1e-12);
});

test('frequency follows L^-2 exactly in Euler–Bernoulli model', () => {
  const f1 = eulerBernoulliFrequency(base);
  const f2 = eulerBernoulliFrequency({ ...base, lengthM: base.lengthM * 2 });
  close(f2 / f1, 0.25);
});

test('frequency is linear in bending thickness and independent of width', () => {
  const f = eulerBernoulliFrequency(base);
  close(eulerBernoulliFrequency({ ...base, thicknessM: 0.001 }) / f, 2);
  close(eulerBernoulliFrequency({ ...base, widthM: 0.06 }) / f, 1);
});

test('material factor is sqrt(E/rho)', () => {
  const f = eulerBernoulliFrequency(base);
  close(eulerBernoulliFrequency({ ...base, youngPa: base.youngPa * 4 }) / f, 2);
  close(eulerBernoulliFrequency({ ...base, densityKgM3: base.densityKgM3 * 4 }) / f, 0.5);
});

test('EB-mode Rayleigh quotient uses independently integrated rotary coefficients', () => {
  [4.647778318679, 32.417399027969, 77.298890802295, 142.901848835370]
    .forEach((expected, index) => close(ROTARY_RAYLEIGH_Q[index], expected, 1e-12));
  const eb = eulerBernoulliFrequency(base);
  const corrected = rayleighRitzFrequency(base);
  assert.ok(corrected < eb);
  close(corrected, 110.19847513888342, 1e-12);
  const long = rayleighRitzFrequency({ ...base, lengthM: base.lengthM * 2 });
  assert.notEqual(long / corrected, 0.25, 'rotary-inertia approximation is not exactly L^-2');
});

test('static force controls displacement, not eigenfrequency', () => {
  const force = tipForceForDeflection({ ...base, displacementM: 0.01 });
  close(staticTipDeflection({ ...base, forceN: force }), 0.01);
  close(eulerBernoulliFrequency({ ...base, forceN: force }), eulerBernoulliFrequency(base));
});

test('first four modal ratios are inharmonic', () => {
  const series = frequencySeries(base);
  const ratios = series.map((f) => f / series[0]);
  [1, 6.266893025770666, 17.547481936106008, 34.38606115720301]
    .forEach((expected, i) => close(ratios[i], expected, 1e-10));
});

test('cantilever mode shape is clamped and normalized at the free end', () => {
  for (let mode = 1; mode <= 4; mode += 1) {
    close(cantileverModeShape(0, mode), 0, 0);
    close(cantileverModeShape(1, mode), 1, 1e-10);
    assert.ok(Math.abs(cantileverModeShape(1e-5, mode)) < 1e-7);
  }
});

test('mode rejects coercive, fractional, and non-finite values', () => {
  const invalidModes = [1.5, 2.0000001, '2', true, false, null, Number.NaN, Infinity, {}, [2]];
  for (const mode of invalidModes) {
    assert.throws(() => eulerBernoulliFrequency({ ...base, mode }), RangeError);
    assert.throws(() => cantileverModeShape(0.5, mode), RangeError);
  }
});

test('beam model identifier rejects unknown and coercive values', () => {
  const invalidModels = ['', 'EB', 'other', null, true, false, 0, {}, [], Symbol('eb'), 1n];
  for (const model of invalidModels) {
    assert.throws(() => frequencySeries(base, model), RangeError);
    assert.throws(() => modelSnapshot({ ...base, model }), RangeError);
  }
});

test('mode shape position requires a primitive finite number', () => {
  const invalidPositions = ['0.5', true, false, null, Number.NaN, Infinity, -Infinity, {}, [0.5], Symbol('x'), 1n];
  for (const xRatio of invalidPositions) {
    assert.throws(() => cantileverModeShape(xRatio, 1), RangeError);
  }
  close(cantileverModeShape(-1, 1), 0, 0);
  close(cantileverModeShape(2, 1), 1, 1e-10);
});

test('numerical model rejects IEEE-754 underflow, overflow, and invalid snapshot scalars', () => {
  assert.throws(() => rectangularSection(Number.MIN_VALUE, Number.MIN_VALUE), RangeError);
  assert.throws(() => rectangularSection(Number.MAX_VALUE, 2), RangeError);
  const hostileStates = [
    { ...base, lengthM: Number.MIN_VALUE },
    { ...base, lengthM: Number.MAX_VALUE },
    { ...base, widthM: Number.MIN_VALUE },
    { ...base, thicknessM: Number.MIN_VALUE },
    { ...base, youngPa: Number.MAX_VALUE, densityKgM3: Number.MIN_VALUE },
  ];
  for (const state of hostileStates) {
    assert.throws(() => eulerBernoulliFrequency(state), RangeError);
    assert.throws(() => modelSnapshot(state), RangeError);
  }
  for (const amplitudeM of [Number.NaN, Infinity, -1]) {
    assert.throws(() => modelSnapshot({ ...base, amplitudeM }), RangeError);
  }
  for (const dampingRatio of [Number.NaN, Infinity, -0.1]) {
    assert.throws(() => modelSnapshot({ ...base, dampingRatio }), RangeError);
  }
  assert.throws(() => tipForceForDeflection({ ...base, displacementM: Number.MAX_VALUE }), RangeError);
});

test('nonzero force, displacement, and amplitude never silently underflow to zero', () => {
  assert.throws(() => staticTipDeflection({ ...base, forceN: Number.MIN_VALUE }), RangeError);
  assert.throws(() => tipForceForDeflection({ ...base, youngPa: 1e5, displacementM: Number.MIN_VALUE }), RangeError);
  assert.throws(() => modelSnapshot({ ...base, youngPa: 1e5, amplitudeM: Number.MIN_VALUE }), RangeError);
  assert.throws(() => modelSnapshot({ ...base, lengthM: 2, youngPa: 1e5, amplitudeM: Number.MIN_VALUE }), RangeError);
  assert.ok(cantileverModeShape(1e-10, 1) > 0, 'stable small-x mode shape remains representable');
  assert.throws(() => cantileverModeShape(Number.MIN_VALUE, 1), RangeError);
  assert.throws(() => cantileverModeShape(4e-163, 2), RangeError);
  assert.throws(() => cantileverModeShape(1e-162, 1), RangeError);
  const subnormalMidpoints = [
    [1, 1.1854055391239837e-162],
    [2, 4.735227089800317e-163],
    [3, 2.82982481249453e-163],
    [4, 2.021509267329591e-163],
  ];
  const boundaryLeaks = [
    [3, 2.68568105324688602e-155],
    [4, 1.91853895486893788e-155],
  ];
  for (const [mode, x] of boundaryLeaks) {
    assert.throws(() => cantileverModeShape(x, mode), RangeError);
  }
  for (const [mode, x] of subnormalMidpoints) {
    assert.throws(() => cantileverModeShape(x, mode), RangeError);
    assert.throws(() => cantileverModeShape(1e-160, mode), RangeError);
    assert.ok(Number.isFinite(cantileverModeShape(1e-153, mode)), `mode ${mode} accepts normal-range tiny shape`);
  }
  for (let mode = 1; mode <= 4; mode += 1) {
    const thresholdX = 1e-2 / BETA_ROOTS[mode - 1];
    const lower = cantileverModeShape(thresholdX * (1 - 1e-10), mode);
    const upper = cantileverModeShape(thresholdX * (1 + 1e-10), mode);
    assert.ok(Math.abs((upper - lower) / lower) < 1e-8, `mode ${mode} is continuous at Taylor threshold`);
  }
});

test('whole-state APIs reject malformed arguments with RangeError', () => {
  const stateApis = [
    eulerBernoulliFrequency,
    rayleighRitzFrequency,
    tipStiffness,
    staticTipDeflection,
    tipForceForDeflection,
    modelSnapshot,
  ];
  for (const api of stateApis) {
    for (const state of [null, undefined, [], 'state', true, 1, Symbol('state'), 1n]) {
      assert.throws(() => api(state), RangeError);
    }
  }
  assert.throws(() => frequencySeries(null), RangeError);
});
