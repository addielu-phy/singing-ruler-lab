import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BETA_ROOTS,
  ROTARY_RAYLEIGH_Q,
  rectangularSection,
  eulerBernoulliFrequency,
  rayleighRitzFrequency,
  frequencySeries,
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
