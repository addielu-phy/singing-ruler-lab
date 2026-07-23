import { cantileverModeShape } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const STEP_TEXT = Object.freeze({
  1: {
    status: '目前顯示第1步：彎曲產生回復作用。',
    caption: '第1步：先把自由端向下壓。彎曲是被視覺放大的概念示意。',
    description: '目前顯示第1步：手向下壓自由端，尺的彎曲與回復作用增加。',
  },
  2: {
    status: '目前顯示第2步：每一小段依照牛頓第二定律加速。',
    caption: '第2步：彈性淨力使各小段加速；質量造成慣性，讓尺衝過平衡位置。',
    description: '目前顯示第2步：尺被分成許多有質量的小段，各段在彈性淨力下加速。',
  },
  3: {
    status: '目前顯示第3步：固定端與自由端條件選出允許的模態與頻率。',
    caption: '第3步：只有同時滿足固定端與自由端四個條件的形狀，才能形成穩定模態。',
    description: '目前顯示第3步：固定端與自由端的限制選出離散模態，圖中示意第一模態。',
  },
});

function makePath(oscillation, amplitude = 54) {
  const points = [];
  const left = 92;
  const right = 704;
  const baseY = 170;
  for (let i = 0; i <= 48; i += 1) {
    const u = i / 48;
    const x = left + (right - left) * u;
    const y = baseY + amplitude * cantileverModeShape(u, 1) * oscillation;
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return points.join(' ');
}

export function initTheoryExplainer() {
  const root = document.querySelector('.theory-story');
  if (!root) return null;

  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = [...root.querySelectorAll('[data-theory-panel]')];
  const visuals = [...root.querySelectorAll('[data-theory-visual]')];
  const status = document.querySelector('#theoryStatus');
  const caption = document.querySelector('#theoryVisualCaption');
  const description = document.querySelector('#theorySvgDesc');
  const autoButton = document.querySelector('#theoryAuto');
  const motionButton = document.querySelector('#theoryMotion');
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const massLayer = document.querySelector('#storyMassLayer');

  let step = 1;
  let motionRunning = !reducedMotionQuery.matches;
  let autoPlaying = false;
  let motionBeforeAutoplay = motionRunning;
  let phase = 0.8;
  let currentOscillation = Math.sin(phase);
  let previousTime = performance.now();
  let lastStepChange = previousTime;

  const massDots = Array.from({ length: 10 }, (_, index) => {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', index % 2 ? '7' : '8');
    circle.setAttribute('class', 'story-mass');
    massLayer.append(circle);
    return circle;
  });
  document.querySelector('#storyModeEnvelope').setAttribute('d', makePath(1, 48));

  const updateButtons = () => {
    autoButton.textContent = autoPlaying ? '停止自動播放' : '自動播放三步';
    motionButton.textContent = motionRunning ? '暫停示意' : '播放示意';
  };

  const publishState = () => {
    window.__THEORY_EXPLAINER__ = {
      initialized: true,
      step,
      motionRunning,
      autoPlaying,
      setStep: (value) => setStep(value, { announce: false }),
      setOscillation: (value) => setOscillation(value),
      pause: () => setMotion(false),
      play: () => setMotion(true),
    };
  };

  function stopAuto({ restoreMotion = false } = {}) {
    if (!autoPlaying) return false;
    autoPlaying = false;
    if (restoreMotion) motionRunning = motionBeforeAutoplay;
    updateButtons();
    previousTime = performance.now();
    return true;
  }

  function setMotion(next, { announce = true } = {}) {
    const wasAutoPlaying = autoPlaying;
    motionRunning = Boolean(next);
    if (!motionRunning && autoPlaying) autoPlaying = false;
    updateButtons();
    previousTime = performance.now();
    drawFrame();
    if (announce) {
      status.textContent = motionRunning
        ? '示意動畫已播放。'
        : wasAutoPlaying
          ? '示意動畫與三步自動播放已暫停。'
          : '示意動畫已暫停。';
    }
    publishState();
  }

  function setOscillation(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) return false;
    currentOscillation = value;
    drawFrame();
    publishState();
    return true;
  }

  function setAutoplay(next) {
    if (next) {
      motionBeforeAutoplay = motionRunning;
      autoPlaying = true;
      motionRunning = true;
      lastStepChange = performance.now();
      previousTime = lastStepChange;
      updateButtons();
      status.textContent = '三步自動播放已開始。';
    } else {
      autoPlaying = false;
      motionRunning = motionBeforeAutoplay;
      previousTime = performance.now();
      updateButtons();
      drawFrame();
      status.textContent = motionRunning
        ? '三步自動播放已停止；示意動畫繼續播放。'
        : '三步自動播放已停止；示意動畫已恢復暫停。';
    }
    publishState();
  }

  function setStep(nextStep, { focus = false, announce = true, manual = false } = {}) {
    if (typeof nextStep !== 'number' || !Number.isInteger(nextStep) || nextStep < 1 || nextStep > 3) return false;
    const normalizedStep = nextStep;
    const focusWasInTabs = tabs.includes(document.activeElement);
    step = normalizedStep;
    if (manual) stopAuto({ restoreMotion: true });
    tabs.forEach((tab) => {
      const selected = Number(tab.dataset.theoryStep) === step;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && (focus || focusWasInTabs)) tab.focus();
    });
    panels.forEach((panel) => { panel.hidden = Number(panel.dataset.theoryPanel) !== step; });
    visuals.forEach((visual) => { visual.toggleAttribute('hidden', Number(visual.dataset.theoryVisual) !== step); });
    caption.textContent = STEP_TEXT[step].caption;
    description.textContent = STEP_TEXT[step].description;
    if (announce) status.textContent = STEP_TEXT[step].status;
    lastStepChange = performance.now();
    drawFrame();
    publishState();
    return true;
  }

  function drawFrame() {
    if (step === 1) {
      const amount = 0.56 + 0.18 * currentOscillation;
      const deflection = 96 * amount;
      document.querySelector('#storyBeam1').setAttribute('d', `M92 170 C270 170 500 ${170 + deflection * 0.24} 704 ${170 + deflection}`);
      document.querySelector('#storyPressArrow').setAttribute('y2', String(170 + deflection - 20));
      return;
    }

    if (step === 2) {
      document.querySelector('#storyBeam2').setAttribute('d', makePath(currentOscillation, 52));
      massDots.forEach((dot, index) => {
        const u = (index + 1) / (massDots.length + 1);
        dot.setAttribute('cx', String(92 + 612 * u));
        dot.setAttribute('cy', String(170 + 52 * cantileverModeShape(u, 1) * currentOscillation));
      });
      const beamY = 170 + 52 * cantileverModeShape(0.7, 1) * currentOscillation;
      const magnitude = Math.abs(currentOscillation);
      const direction = currentOscillation >= 0 ? 1 : -1;
      const arrow = document.querySelector('#storyAccelArrow');
      arrow.setAttribute('y1', String(beamY + direction * (12 + 60 * magnitude)));
      arrow.setAttribute('y2', String(beamY + direction * 12));
      arrow.style.opacity = String(Math.min(1, magnitude * 1.8));
      return;
    }

    document.querySelector('#storyBeam3').setAttribute('d', makePath(currentOscillation, 48));
    document.querySelector('.boundary-dot.free').setAttribute('cy', String(170 + 48 * currentOscillation));
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setStep(index + 1, { manual: true }));
    tab.addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const focusedIndex = tabs.indexOf(event.currentTarget);
      const next = event.key === 'Home' ? 1
        : event.key === 'End' ? tabs.length
          : event.key === 'ArrowRight' ? ((focusedIndex + 1) % tabs.length) + 1
            : ((focusedIndex - 1 + tabs.length) % tabs.length) + 1;
      setStep(next, { focus: true, manual: true });
    });
  });

  autoButton.addEventListener('click', () => setAutoplay(!autoPlaying));
  motionButton.addEventListener('click', () => setMotion(!motionRunning));

  const handleReducedMotionChange = (event) => {
    if (!event.matches) return;
    autoPlaying = false;
    motionRunning = false;
    updateButtons();
    previousTime = performance.now();
    drawFrame();
    status.textContent = '系統已切換為減少動態；示意動畫與自動播放已暫停。';
    publishState();
  };
  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
  } else {
    reducedMotionQuery.addListener(handleReducedMotionChange);
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - previousTime) / 1000);
    previousTime = now;
    if (motionRunning) {
      phase += dt * 1.9;
      currentOscillation = Math.sin(phase);
      drawFrame();
    }
    if (autoPlaying && now - lastStepChange >= 4800) {
      setStep((step % 3) + 1);
    }
    requestAnimationFrame(tick);
  }

  setStep(1, { announce: false });
  setMotion(motionRunning, { announce: false });
  requestAnimationFrame(tick);
  return { getState: () => ({ step, motionRunning, autoPlaying }) };
}
