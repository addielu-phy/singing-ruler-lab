import {
  BETA_ROOTS,
  MATERIALS,
  cantileverModeShape,
  modelSnapshot,
} from './model.js';
import { initTheoryExplainer } from './theory-explainer.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const controls = {
  material: $('#material'), young: $('#young'), density: $('#density'),
  length: $('#length'), thickness: $('#thickness'), width: $('#width'),
  amplitude: $('#amplitude'), mode: $('#mode'), model: $('#model'), speed: $('#speed'),
};
const defaults = Object.fromEntries(Object.entries(controls).map(([key, el]) => [key, el.value]));
initTheoryExplainer();
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let running = !motionPreference.matches;
let phase = 0;
let previousFrame = performance.now();
let currentState;
let currentSnapshot;
let audioContext;
let activeOscillator;
let activeGain;
let toneGeneration = 0;
let announcementTimer;

const fmt = (value, digits = 2) => Number(value).toLocaleString('zh-TW', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

const frozenCopy = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, frozenCopy(nested)])));
  }
  return value;
};

function setValidation(message = '', invalidControls = []) {
  $('#customValidation').textContent = message;
  for (const control of [controls.young, controls.density]) {
    control.setAttribute('aria-invalid', String(invalidControls.includes(control)));
  }
}

function invalidCustomControls() {
  if (controls.material.value !== 'custom') return [];
  return [controls.young, controls.density].filter((control) => !control.validity.valid
    || control.value.trim() === '' || !Number.isFinite(Number(control.value)));
}

function stateFromControls() {
  const key = controls.material.value;
  const preset = key === 'custom' ? {
    youngPa: Number(controls.young.value) * 1e9,
    densityKgM3: Number(controls.density.value),
  } : MATERIALS[key];
  return {
    lengthM: Number(controls.length.value) / 100,
    thicknessM: Number(controls.thickness.value) / 1000,
    widthM: Number(controls.width.value) / 1000,
    amplitudeM: Number(controls.amplitude.value) / 1000,
    youngPa: preset.youngPa,
    densityKgM3: preset.densityKgM3,
    mode: Number(controls.mode.value),
    model: controls.model.value,
  };
}

function setRangeText(id, text, ariaText = text) {
  $(`#${id}Out`).textContent = text;
  controls[id].setAttribute('aria-valuetext', ariaText);
}

function updateMaterialInputs() {
  const custom = controls.material.value === 'custom';
  $('.custom-material').hidden = !custom;
  controls.young.disabled = !custom;
  controls.density.disabled = !custom;
  if (!custom) {
    const material = MATERIALS[controls.material.value];
    controls.young.value = material.youngPa / 1e9;
    controls.density.value = material.densityKgM3;
  }
}

function updateOutputs() {
  clearTimeout(announcementTimer);
  announcementTimer = undefined;
  updateMaterialInputs();
  const invalidControls = invalidCustomControls();
  if (invalidControls.length) {
    const messages = [];
    if (invalidControls.includes(controls.young)) messages.push('楊氏係數請輸入0.1至500 GPa之間的數值。');
    if (invalidControls.includes(controls.density)) messages.push('密度請輸入100至25,000 kg/m³之間的數值。');
    setValidation(messages.join(' '), invalidControls);
    return false;
  }
  let nextState;
  let nextSnapshot;
  try {
    nextState = stateFromControls();
    nextSnapshot = modelSnapshot(nextState);
    const finiteValues = [
      nextSnapshot.frequencyHz,
      nextSnapshot.ebFrequencyHz,
      nextSnapshot.ritzFrequencyHz,
      nextSnapshot.periodMs,
      nextSnapshot.tipForceN,
      nextSnapshot.massKg,
      nextSnapshot.ebSlopeHzCm2,
      ...nextSnapshot.seriesHz,
    ];
    if (!finiteValues.every(Number.isFinite)) throw new RangeError('計算結果超出可顯示範圍');
  } catch (error) {
    setValidation(`目前輸入無法計算：${error.message}`);
    return false;
  }
  setValidation();
  currentState = nextState;
  currentSnapshot = nextSnapshot;
  const s = currentSnapshot;
  setRangeText('length', `${fmt(currentState.lengthM * 100, 1)} cm`, `有效長度${fmt(currentState.lengthM * 100, 1)}公分`);
  setRangeText('thickness', `${fmt(currentState.thicknessM * 1000, 2)} mm`, `彎曲厚度${fmt(currentState.thicknessM * 1000, 2)}毫米`);
  setRangeText('width', `${fmt(currentState.widthM * 1000, 0)} mm`, `尺寬${fmt(currentState.widthM * 1000, 0)}毫米`);
  setRangeText('amplitude', `${fmt(currentState.amplitudeM * 1000, 0)} mm`, `釋放位移${fmt(currentState.amplitudeM * 1000, 0)}毫米`);
  setRangeText('speed', `${fmt(Number(controls.speed.value), 2)}×`, `動畫展示速率${fmt(Number(controls.speed.value), 2)}倍`);
  $('#frequencyMetric').textContent = fmt(s.frequencyHz, s.frequencyHz < 10 ? 3 : 2);
  $('#periodMetric').textContent = fmt(s.periodMs, 2);
  $('#betaMetric').textContent = fmt(s.beta, 4);
  $('#forceMetric').textContent = fmt(s.tipForceN, 2);
  $('#slenderMetric').textContent = fmt(s.slenderness, 0);
  $('#massMetric').textContent = fmt(s.massKg * 1000, 2);
  $('#slopeLabel').textContent = `EB斜率 ${fmt(s.ebSlopeHzCm2, 0)} Hz·cm²`;
  $('#modelStatus').textContent = currentState.model === 'eb'
    ? 'Euler–Bernoulli細梁模型'
    : `EB模態Rayleigh–Ritz近似：比EB低${fmt(s.correctionPercent, 3)}%`;
  $('#betaNote').textContent = currentState.model === 'eb' ? '無因次' : 'EB試函數';
  $('#visualSummary').textContent = `第${currentState.mode}模態；理論頻率${fmt(s.frequencyHz, 2)} Hz；動畫時間經縮放。`;
  updateWarning();
  updateWorkedExample();
  drawLengthChart();
  drawRuler(phase);
  scheduleResultAnnouncement();
  document.documentElement.dataset.ready = 'true';
  window.__SINGING_RULER__ = {
    state: frozenCopy(currentState),
    snapshot: frozenCopy(currentSnapshot),
    get running() { return running; },
    modelVersion: '1.1.0', pause: () => setRunning(false), resume: () => setRunning(true),
  };
  return true;
}

function scheduleResultAnnouncement() {
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => {
    const modelName = currentState.model === 'eb'
      ? 'Euler Bernoulli模型'
      : 'EB模態Rayleigh Ritz近似';
    $('#resultAnnouncement').textContent = `${modelName}，第${currentState.mode}模態，理論頻率${fmt(currentSnapshot.frequencyHz, 2)}赫茲，週期${fmt(currentSnapshot.periodMs, 2)}毫秒。`;
  }, 300);
}

function updateWarning() {
  const box = $('#modelWarning');
  box.className = 'model-warning';
  const problems = [];
  if (currentSnapshot.slenderness < 20) {
    problems.push(`L/h=${fmt(currentSnapshot.slenderness, 1)}，已超出常用細梁範圍；應改用完整Timoshenko模型。`);
    box.classList.add('danger');
  } else if (currentSnapshot.slenderness < 50) {
    problems.push(`L/h=${fmt(currentSnapshot.slenderness, 1)}，厚梁效應可能不可忽略。`);
    box.classList.add('warn');
  }
  if (currentSnapshot.amplitudeRatio > 0.1) {
    problems.push(`δ/L=${fmt(currentSnapshot.amplitudeRatio, 3)}，大振幅可能破壞線性假設。`);
    if (!box.classList.contains('danger')) box.classList.add('warn');
  }
  if (!problems.length) problems.push(`L/h=${fmt(currentSnapshot.slenderness, 0)}、δ/L=${fmt(currentSnapshot.amplitudeRatio, 3)}；目前設定符合本模型的基本近似範圍。`);
  box.textContent = problems.join(' ');
}

function updateWorkedExample() {
  const s = currentSnapshot;
  const superscript = (n) => String(n).replace(/-/g, '⁻').replace(/0/g, '⁰').replace(/1/g, '¹').replace(/2/g, '²').replace(/3/g, '³').replace(/4/g, '⁴').replace(/5/g, '⁵').replace(/6/g, '⁶').replace(/7/g, '⁷').replace(/8/g, '⁸').replace(/9/g, '⁹');
  const sci = (value, digits = 3) => {
    const exponent = Math.floor(Math.log10(Math.abs(value)));
    return `${fmt(value / 10 ** exponent, digits)}×10${superscript(exponent)}`;
  };
  $('#workedSection').textContent = `A = ${sci(s.areaM2, 2)} m²；I = ${sci(s.inertiaM4, 3)} m⁴`;
  $('#workedMaterial').textContent = `√(E/ρ) = ${fmt(Math.sqrt(currentState.youngPa / currentState.densityKgM3), 2)} m/s`;
  $('#workedModeLabel').textContent = `代入第${currentState.mode}模態`;
  $('#workedSubstitution').textContent = `f${currentState.mode === 1 ? '₁' : `（模態${currentState.mode}）`} = ${fmt(s.frequencyHz, 2)} Hz`;
}

function drawRuler(displayPhase) {
  const points = [];
  const left = 98; const right = 716; const baseY = 170;
  const amplitudePx = Math.min(92, 28 + currentState.amplitudeM / currentState.lengthM * 300);
  const oscillation = Math.sin(displayPhase);
  for (let i = 0; i <= 90; i += 1) {
    const xRatio = i / 90;
    const x = left + (right - left) * xRatio;
    const y = baseY + amplitudePx * cantileverModeShape(xRatio, currentState.mode) * oscillation;
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  $('#rulerPath').setAttribute('d', points.join(' '));
  const nodeLayer = $('#nodeLayer');
  nodeLayer.replaceChildren();
  const samples = 500;
  let last = cantileverModeShape(0.001, currentState.mode);
  for (let i = 2; i < samples; i += 1) {
    const xRatio = i / samples;
    const value = cantileverModeShape(xRatio, currentState.mode);
    if (Math.sign(value) !== Math.sign(last)) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(left + (right - left) * xRatio));
      circle.setAttribute('cy', String(baseY));
      circle.setAttribute('r', '6');
      circle.setAttribute('class', 'node-mark');
      nodeLayer.append(circle);
    }
    last = value;
  }
}

function drawLengthChart() {
  const svg = $('#lengthChart');
  const narrow = window.matchMedia('(max-width: 767px)').matches;
  const width = narrow ? 360 : 700;
  const height = narrow ? 300 : 320;
  const baseMargin = narrow
    ? { right: 16, top: 22, bottom: 60 }
    : { right: 22, top: 25, bottom: 52 };
  const points = [];
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  for (let lengthCm = 3; lengthCm <= 20; lengthCm += 0.5) {
    const state = { ...currentState, lengthM: lengthCm / 100, model: 'eb' };
    const frequency = modelSnapshot(state).ebFrequencyHz;
    points.push({ x: 1 / lengthCm ** 2, y: frequency, lengthCm });
  }
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y)) * 1.08;
  const el = (name, attrs = {}, text = '') => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  };
  svg.replaceChildren(svg.querySelector('title'), svg.querySelector('desc'));

  const tickCount = narrow ? 2 : 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = maxY * index / tickCount;
    return { value, label: fmt(value, 0) };
  });
  const measureLayer = el('g', { visibility: 'hidden', 'aria-hidden': 'true' });
  const tickMeasures = yTicks.map(({ label }) => el('text', { class: 'chart-text' }, label));
  const titleMeasure = el('text', { x: 0, y: 0, class: 'chart-text' }, 'EB頻率 f（Hz）');
  measureLayer.append(...tickMeasures, titleMeasure);
  svg.append(measureLayer);
  const maxTickWidth = Math.max(...tickMeasures.map((node) => node.getComputedTextLength()));
  const titleBox = titleMeasure.getBBox();
  measureLayer.remove();

  const edgePadding = 8;
  const titleTickGap = 8;
  const tickAxisGap = 10;
  const axisX = Math.ceil(edgePadding - titleBox.y);
  const titleRight = axisX + titleBox.y + titleBox.height;
  const margin = {
    ...baseMargin,
    left: Math.ceil(titleRight + titleTickGap + maxTickWidth + tickAxisGap),
  };
  const sx = (x) => margin.left + x / maxX * (width - margin.left - margin.right);
  const sy = (y) => height - margin.bottom - y / maxY * (height - margin.top - margin.bottom);

  for (const tick of yTicks) {
    svg.append(el('line', { x1: margin.left, x2: width - margin.right, y1: sy(tick.value), y2: sy(tick.value), class: 'chart-grid' }));
    svg.append(el('text', { x: margin.left - tickAxisGap, y: sy(tick.value) + 5, 'text-anchor': 'end', class: 'chart-text' }, tick.label));
  }
  svg.append(el('line', { x1: margin.left, x2: margin.left, y1: margin.top, y2: height - margin.bottom, class: 'chart-axis' }));
  svg.append(el('line', { x1: margin.left, x2: width - margin.right, y1: height - margin.bottom, y2: height - margin.bottom, class: 'chart-axis' }));
  svg.append(el('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)} ${sy(p.y)}`).join(' '), class: 'chart-line' }));
  points.filter((_, i) => i % 5 === 0).forEach((p) => svg.append(el('circle', { cx: sx(p.x), cy: sy(p.y), r: narrow ? 5 : 4, class: 'chart-point' })));
  const selectedX = 1 / (currentState.lengthM * 100) ** 2;
  svg.append(el('circle', { cx: sx(selectedX), cy: sy(currentSnapshot.ebFrequencyHz), r: narrow ? 8 : 7, class: 'chart-selected' }));
  svg.append(el('text', { x: width / 2, y: height - 14, 'text-anchor': 'middle', class: 'chart-text' }, '1 / L²（cm⁻²）'));
  svg.append(el('text', { x: axisX, y: height / 2, transform: `rotate(-90 ${axisX} ${height / 2})`, 'text-anchor': 'middle', class: 'chart-text' }, 'EB頻率 f（Hz）'));
  $('#chartDesc').textContent = `圖中固定使用Euler–Bernoulli模型；所選長度的EB基準頻率為${fmt(currentSnapshot.ebFrequencyHz, 2)}赫茲，頻率與一除以長度平方呈直線。`;
  $('#chartLengthValue').textContent = `${fmt(currentState.lengthM * 100, 1)} cm`;
  $('#chartFrequencyValue').textContent = `${fmt(currentSnapshot.ebFrequencyHz, 2)} Hz`;
}

function setRunning(next, { announce = false, reducedMotion = false } = {}) {
  running = Boolean(next);
  $('#toggleMotion').textContent = running ? '暫停動畫' : '繼續動畫';
  if (announce) {
    $('#motionStatus').textContent = reducedMotion
      ? '偵測到減少動態偏好，尺的振動動畫已暫停。'
      : `尺的振動動畫已${running ? '繼續播放' : '暫停'}。`;
  }
}

function animate(now) {
  const dt = Math.min(0.05, (now - previousFrame) / 1000);
  previousFrame = now;
  if (running && currentState) {
    phase += dt * 2 * Math.PI * (0.55 + currentState.mode * 0.12) * Number(controls.speed.value);
    drawRuler(phase);
  }
  requestAnimationFrame(animate);
}

function stopTone(announce = true) {
  toneGeneration += 1;
  if (activeOscillator) {
    try { activeOscillator.stop(); } catch { /* already stopped */ }
    activeOscillator.disconnect(); activeOscillator = null;
  }
  if (activeGain) { activeGain.disconnect(); activeGain = null; }
  if (announce) $('#audioStatus').textContent = '聲音已停止。純音只示意理論頻率，不是完整聲學模擬。';
}

async function playTone() {
  stopTone(false);
  const generation = toneGeneration;
  audioContext ||= new AudioContext();
  await audioContext.resume();
  if (generation !== toneGeneration) return;
  const frequency = currentSnapshot.frequencyHz;
  if (frequency < 20 || frequency > 16000) {
    $('#audioStatus').textContent = `目前${fmt(frequency, 2)} Hz超出此示意播放器的20–16000 Hz範圍。`;
    return;
  }
  activeOscillator = audioContext.createOscillator();
  activeGain = audioContext.createGain();
  activeOscillator.type = 'sine';
  activeOscillator.frequency.value = frequency;
  activeGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  activeGain.gain.exponentialRampToValueAtTime(0.055, audioContext.currentTime + 0.03);
  activeGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 1.15);
  activeOscillator.connect(activeGain).connect(audioContext.destination);
  activeOscillator.start(); activeOscillator.stop(audioContext.currentTime + 1.2);
  const oscillator = activeOscillator;
  oscillator.addEventListener('ended', () => {
    if (generation !== toneGeneration) return;
    activeOscillator = null;
    $('#audioStatus').textContent = `已播放${fmt(frequency, 2)} Hz純音示意。`;
  }, { once: true });
  $('#audioStatus').textContent = `正在播放${fmt(frequency, 2)} Hz純音示意。`;
}

Object.values(controls).forEach((control) => control.addEventListener('input', updateOutputs));
controls.material.addEventListener('change', updateOutputs);
$('#toggleMotion').addEventListener('click', () => setRunning(!running, { announce: true }));
$('#reset').addEventListener('click', () => {
  Object.entries(defaults).forEach(([key, value]) => { controls[key].value = value; });
  phase = 0; stopTone(); updateOutputs();
});
$('#playTone').addEventListener('click', playTone);
$('#stopTone').addEventListener('click', () => stopTone());

const detailMedia = window.matchMedia('(max-width: 767px)');
const syncDetails = () => $$('.deep-dive').forEach((detail) => { detail.open = !detailMedia.matches; });
syncDetails();
detailMedia.addEventListener('change', () => {
  syncDetails();
  if (currentState) drawLengthChart();
});
let chartResizeFrame = 0;
const scheduleChartRedraw = () => {
  cancelAnimationFrame(chartResizeFrame);
  chartResizeFrame = requestAnimationFrame(() => {
    chartResizeFrame = 0;
    if (currentState) drawLengthChart();
  });
};
window.addEventListener('resize', scheduleChartRedraw, { passive: true });
if (document.fonts) {
  document.fonts.ready.then(scheduleChartRedraw);
  document.fonts.addEventListener('loadingdone', scheduleChartRedraw);
}
motionPreference.addEventListener('change', (event) => {
  if (event.matches) setRunning(false, { announce: true, reducedMotion: true });
});

function focusHashTarget() {
  let id;
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  if (!id) return;
  const target = document.getElementById(id);
  if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
}
$$('a[href^="#"]').forEach((anchor) => anchor.addEventListener('click', () => setTimeout(focusHashTarget, 0)));
window.addEventListener('hashchange', focusHashTarget);

updateOutputs();
setRunning(running);
requestAnimationFrame(animate);
if (location.hash) focusHashTarget();
