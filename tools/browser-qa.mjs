import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axeSource = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:9057/';
const outDir = process.env.QA_DIR || 'qa';
await fs.mkdir(outDir, { recursive: true });
const report = { url: baseURL, viewports: {}, interactions: {}, axe: {} };
const browser = await chromium.launch({ headless: true });

async function loadPage(context, label) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  const response = await page.goto(baseURL, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200, `${label}: HTTP status`);
  assert.equal(await page.title(), '會唱歌的尺｜懸臂梁振動理論與互動實驗');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.deepEqual(errors, [], `${label}: JavaScript errors`);
  return { page, errors };
}

async function structuralChecks(page, label, expectedWidth, mobile) {
  await page.locator('#reset').focus();
  const result = await page.evaluate(({ expectedWidth, mobile }) => {
    const theory = document.querySelector('#theory');
    const lab = document.querySelector('#lab');
    const formulas = [...document.querySelectorAll('[role="math"]')];
    const unnamedAsides = [...document.querySelectorAll('aside')].filter((x) => !x.getAttribute('aria-label') && !x.getAttribute('aria-labelledby'));
    const luminance = (color) => {
      const rgb = color.match(/\d+/g).slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    const contrastRatio = (foreground, background) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const firstGradientColor = (element) => getComputedStyle(element).backgroundImage.match(/rgb\([^)]*\)/)?.[0];
    const focusColor = getComputedStyle(document.querySelector('#reset')).outlineColor;
    const focusContrast = (luminance('rgb(255,255,255)') + 0.05) / (luminance(focusColor) + 0.05);
    const theoryApi = window.__THEORY_EXPLAINER__;
    const theorySteps = [1, 2, 3].map((step) => {
      theoryApi?.setStep(step);
      const panel = document.querySelector(`[data-theory-panel="${step}"]`);
      const visual = document.querySelector(`[data-theory-visual="${step}"]`);
      const labels = [...visual.querySelectorAll('text')];
      const clippedLabels = labels.map((label) => {
        const box = label.getBBox();
        return { text: label.textContent, x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height };
      }).filter((box) => box.x < -1 || box.y < -1 || box.right > 761 || box.bottom > 361);
      const renderedBoxes = labels.map((label) => {
        const box = label.getBoundingClientRect();
        return { text: label.textContent, left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      });
      const overlappingLabels = [];
      for (let first = 0; first < renderedBoxes.length; first += 1) {
        for (let second = first + 1; second < renderedBoxes.length; second += 1) {
          const a = renderedBoxes[first];
          const b = renderedBoxes[second];
          const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapWidth > 0.5 && overlapHeight > 0.5) overlappingLabels.push([a.text, b.text]);
        }
      }
      const graphicOverlaps = [];
      if (step === 3) {
        const envelope = document.querySelector('#storyModeEnvelope');
        const animatedBeam = document.querySelector('#storyBeam3');
        const pathLength = envelope.getTotalLength();
        const halfStroke = Math.max(
          Number.parseFloat(getComputedStyle(envelope).strokeWidth),
          Number.parseFloat(getComputedStyle(animatedBeam).strokeWidth),
        ) / 2;
        const labelBoxes = labels.map((label) => ({ text: label.textContent, box: label.getBBox() }));
        for (let sample = 0; sample <= 400; sample += 1) {
          const point = envelope.getPointAtLength((pathLength * sample) / 400);
          const extrema = [point.y, 340 - point.y];
          labelBoxes.forEach(({ text, box }) => {
            const insideX = point.x >= box.x - halfStroke && point.x <= box.x + box.width + halfStroke;
            const intersectsY = extrema.some((y) => y >= box.y - halfStroke && y <= box.y + box.height + halfStroke);
            if (insideX && intersectsY && !graphicOverlaps.includes(text)) graphicOverlaps.push(text);
          });
        }
      }
      const heading = document.querySelector('.story-heading');
      const tabsContainer = document.querySelector('.story-tabs');
      const visualContainer = document.querySelector('.story-visual');
      const storySvg = document.querySelector('#theorySvg');
      const controls = document.querySelector('.story-controls');
      const comesBefore = (first, second) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
      const tabsRect = tabsContainer.getBoundingClientRect();
      const visualRect = visualContainer.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      return {
        step,
        visiblePanels: [...document.querySelectorAll('[data-theory-panel]')].filter((x) => !x.hidden).length,
        visibleVisuals: [...document.querySelectorAll('[data-theory-visual]')].filter((x) => !x.hasAttribute('hidden')).length,
        selectedTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].length,
        panelOverflow: panel.scrollWidth > panel.clientWidth + 1,
        formulaOverflow: [...panel.querySelectorAll('.formula')].some((x) => x.scrollWidth > x.clientWidth + 1),
        labelCount: labels.length,
        minLabelHeight: labels.length ? Math.min(...labels.map((x) => x.getBoundingClientRect().height)) : 0,
        clippedLabels,
        overlappingLabels,
        graphicOverlaps,
        panelFocusable: panel.tabIndex === 0,
        fullDomSequence: comesBefore(heading, tabsContainer)
          && comesBefore(tabsContainer, storySvg)
          && comesBefore(storySvg, panel)
          && comesBefore(panel, controls),
        mobileVisualBetweenTabsAndPanel: !mobile || (visualRect.top >= tabsRect.bottom - 1 && visualRect.bottom <= panelRect.top + 1),
      };
    });
    theoryApi?.setStep(1);
    const storyBackground = getComputedStyle(document.querySelector('.story-visual')).backgroundColor;
    const hookBackground = firstGradientColor(document.querySelector('.student-hook'));
    const labBackground = firstGradientColor(document.querySelector('.lab-section'));
    const contrastChecks = [
      ['body text', getComputedStyle(document.body).color, getComputedStyle(document.body).backgroundColor],
      ['muted source text', getComputedStyle(document.querySelector('.source-note')).color, getComputedStyle(document.body).backgroundColor],
      ['green eyebrow', getComputedStyle(document.querySelector('.hero-copy .eyebrow')).color, getComputedStyle(document.body).backgroundColor],
      ['brand mark', getComputedStyle(document.querySelector('.brand-mark')).color, getComputedStyle(document.querySelector('.brand-mark')).backgroundColor],
      ['hero formula', getComputedStyle(document.querySelector('.hero-equation')).color, getComputedStyle(document.querySelector('.hero-equation')).backgroundColor],
      ['story hook heading', getComputedStyle(document.querySelector('.student-hook strong')).color, hookBackground],
      ['story hook text', getComputedStyle(document.querySelector('.student-hook span')).color, hookBackground],
      ['story SVG label', getComputedStyle(document.querySelector('.story-svg-label')).fill, storyBackground],
      ['story SVG note', getComputedStyle(document.querySelector('.story-svg-note')).fill, storyBackground],
      ['story SVG green label', getComputedStyle(document.querySelector('.story-green')).fill, storyBackground],
      ['story SVG mode tag', getComputedStyle(document.querySelector('.mode-tags text')).fill, storyBackground],
      ['lab muted text', getComputedStyle(document.querySelector('.split-heading p')).color, labBackground],
    ].map(([name, foreground, background]) => ({ name, foreground, background, ratio: contrastRatio(foreground, background) }));
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      theoryBeforeLab: Boolean(theory.compareDocumentPosition(lab) & Node.DOCUMENT_POSITION_FOLLOWING),
      theoryReady: Boolean(theoryApi && document.querySelectorAll('[role="tab"]').length === 3),
      theorySteps,
      formulaCount: formulas.length,
      mathLabelsValid: formulas.every((x) => (x.getAttribute('aria-label') || '').length >= 18 && /[一二三四五六七八九十等於乘除平方根加負]/.test(x.getAttribute('aria-label'))),
      unnamedAsides: unnamedAsides.length,
      details: [...document.querySelectorAll('.deep-dive')].map((x) => x.open),
      customHidden: document.querySelector('.custom-material').hidden && getComputedStyle(document.querySelector('.custom-material')).display === 'none',
      ranges: [...document.querySelectorAll('input[type="range"]')].map((x) => ({ id: x.id, height: x.getBoundingClientRect().height, aria: x.getAttribute('aria-valuetext') })),
      targetSizes: [...document.querySelectorAll('button, select, input:not([disabled]), summary, .button, .nav-cta')].filter((x) => !x.closest('[hidden]')).map((x) => ({ label: x.id || x.textContent.trim().slice(0, 30), w: x.getBoundingClientRect().width, h: x.getBoundingClientRect().height })).filter((x) => x.w < 44 || x.h < 44),
      mainReady: Boolean(window.__SINGING_RULER__?.snapshot?.frequencyHz),
      mainFocusable: document.querySelector('#main').tabIndex === -1,
      liveResult: document.querySelector('#resultAnnouncement')?.getAttribute('role') === 'status',
      forceText: document.querySelector('#forceMetric')?.textContent,
      chartTextHeight: document.querySelector('.chart-text')?.getBoundingClientRect().height || 0,
      rulerLabelHeight: document.querySelector('.svg-label')?.getBoundingClientRect().height || 0,
      chartIsEbBaseline: document.querySelector('.chart-heading h3')?.textContent.includes('EB基準'),
      focusColor,
      focusContrast,
      contrastChecks,
      expectedWidth,
      mobile,
    };
  }, { expectedWidth, mobile });
  assert.equal(result.clientWidth, expectedWidth, `${label}: exact viewport`);
  assert.equal(result.scrollWidth, expectedWidth, `${label}: page horizontal overflow`);
  assert.equal(result.theoryBeforeLab, true, `${label}: theory before lab`);
  assert.equal(result.theoryReady, true, `${label}: theory explainer API and three tabs ready`);
  assert.equal(result.theorySteps.length, 3, `${label}: all three theory steps inspected`);
  result.theorySteps.forEach((step) => {
    assert.equal(step.visiblePanels, 1, `${label}: step ${step.step} has one visible panel`);
    assert.equal(step.visibleVisuals, 1, `${label}: step ${step.step} has one visible visual`);
    assert.equal(step.selectedTabs, 1, `${label}: step ${step.step} has one selected tab`);
    assert.equal(step.panelOverflow, false, `${label}: step ${step.step} panel overflow`);
    assert.equal(step.formulaOverflow, false, `${label}: step ${step.step} formula overflow`);
    assert.ok(step.labelCount > 0, `${label}: step ${step.step} has SVG labels`);
    const minimumLabelHeight = 14;
    assert.ok(step.minLabelHeight >= minimumLabelHeight, `${label}: step ${step.step} SVG labels readable (${step.minLabelHeight}px)`);
    assert.deepEqual(step.clippedLabels, [], `${label}: step ${step.step} SVG labels clipped`);
    assert.deepEqual(step.overlappingLabels, [], `${label}: step ${step.step} SVG labels overlap`);
    assert.deepEqual(step.graphicOverlaps, [], `${label}: step ${step.step} SVG labels overlap the mode path at an animation extremum`);
    assert.equal(step.panelFocusable, true, `${label}: step ${step.step} tabpanel is keyboard-focusable`);
    assert.equal(step.fullDomSequence, true, `${label}: step ${step.step} DOM/accessibility order is heading, tabs, SVG, panel, controls`);
    assert.equal(step.mobileVisualBetweenTabsAndPanel, true, `${label}: step ${step.step} mobile visual follows tabs before panel`);
  });
  assert.ok(result.formulaCount >= 14, `${label}: formula count`);
  assert.equal(result.mathLabelsValid, true, `${label}: complete Traditional Chinese math labels`);
  assert.equal(result.unnamedAsides, 0, `${label}: unnamed complementary landmarks`);
  assert.equal(result.customHidden, true, `${label}: hidden custom controls`);
  assert.equal(result.mainReady, true, `${label}: app ready API`);
  assert.equal(result.mainFocusable, true, `${label}: skip-link target focusable`);
  assert.equal(result.liveResult, true, `${label}: live calculation summary`);
  assert.equal(result.forceText, '4.19', `${label}: default 5 mm release force`);
  assert.equal(result.chartIsEbBaseline, true, `${label}: length chart explicitly EB-only`);
  assert.ok(result.focusContrast >= 3, `${label}: focus indicator contrast ${result.focusContrast}`);
  assert.equal(result.contrastChecks.every((check) => check.ratio >= 4.5), true, `${label}: conservative color contrast ${JSON.stringify(result.contrastChecks)}`);
  if (mobile) {
    assert.ok(result.chartTextHeight >= 10, `${label}: chart text readable (${result.chartTextHeight}px)`);
    assert.ok(result.rulerLabelHeight >= 10, `${label}: ruler labels readable (${result.rulerLabelHeight}px)`);
  }
  assert.equal(result.details.every((v) => v === !mobile), true, `${label}: responsive theory disclosure state`);
  assert.equal(result.ranges.every((x) => x.height >= 44 && x.aria), true, `${label}: range size and localized aria-valuetext`);
  assert.deepEqual(result.targetSizes, [], `${label}: undersized targets`);

  await page.evaluate(() => document.querySelectorAll('.deep-dive').forEach((x) => { x.open = true; }));
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.formula, blockquote, .symbol-grid > div, .worked-example code, .mode-table')]
    .filter((x) => x.getClientRects().length)
    .map((x) => ({ text: x.textContent.trim().slice(0, 45), clientWidth: x.clientWidth, scrollWidth: x.scrollWidth }))
    .filter((x) => x.scrollWidth > x.clientWidth + 1));
  assert.deepEqual(overflow, [], `${label}: dense content overflow`);

  await page.evaluate(axeSource);
  const axe = await page.evaluate(async () => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
  assert.deepEqual(axe.violations, [], `${label}: axe violations ${JSON.stringify(axe.violations.map((x) => x.id))}`);
  report.axe[label] = { violations: 0, incomplete: axe.incomplete.map((x) => ({ id: x.id, nodes: x.nodes.length })) };
  report.viewports[label] = result;
}

async function interactionChecks(page) {
  const getFrequency = () => page.locator('#frequencyMetric').textContent().then((x) => Number(x.replace(/,/g, '')));
  const setRange = async (id, value) => {
    await page.locator(`#${id}`).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  };
  const invalidStepInputs = await page.evaluate(() => {
    const before = {
      step: window.__THEORY_EXPLAINER__.step,
      selected: document.querySelector('[role="tab"][aria-selected="true"]').id,
    };
    const values = [
      true,
      [2],
      {},
      Symbol('x'),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      0,
      4,
      { [Symbol.toPrimitive]() { throw new Error('coercion must not run'); } },
    ];
    const results = values.map((value) => {
      try {
        return { returned: window.__THEORY_EXPLAINER__.setStep(value), threw: false };
      } catch (error) {
        return { returned: null, threw: true, name: error.name };
      }
    });
    return {
      before,
      after: {
        step: window.__THEORY_EXPLAINER__.step,
        selected: document.querySelector('[role="tab"][aria-selected="true"]').id,
      },
      results,
    };
  });
  assert.deepEqual(invalidStepInputs.results, invalidStepInputs.results.map(() => ({ returned: false, threw: false })), 'public setStep rejects invalid inputs without coercion or exceptions');
  assert.deepEqual(invalidStepInputs.after, invalidStepInputs.before, 'invalid setStep inputs do not mutate state or DOM');

  await page.locator('#story-tab-2').click();
  assert.equal(await page.locator('#story-tab-2').getAttribute('aria-selected'), 'true', 'theory tab click selects step 2');
  assert.equal(await page.locator('#story-panel-2').isVisible(), true, 'theory step 2 panel visible');
  for (let sampleIndex = 0; sampleIndex < 8; sampleIndex += 1) {
    const sample = await page.evaluate(() => {
      const beam = document.querySelector('#storyBeam2');
      const tip = beam.getPointAtLength(beam.getTotalLength());
      const arrow = document.querySelector('#storyAccelArrow');
      return {
        displacement: tip.y - 170,
        arrowDirection: Number(arrow.getAttribute('y2')) - Number(arrow.getAttribute('y1')),
        opacity: Number(getComputedStyle(arrow).opacity),
      };
    });
    if (sample.opacity > 0.05 && Math.abs(sample.displacement) > 0.5) {
      assert.ok(sample.displacement * sample.arrowDirection < 0, 'step 2 acceleration arrow opposes displacement');
    }
    await page.waitForTimeout(45);
  }
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'story-tab-3', 'theory tabs support ArrowRight focus');
  assert.equal(await page.locator('#story-tab-3').getAttribute('aria-selected'), 'true', 'ArrowRight selects theory step 3');
  assert.match(await page.locator('#theorySvgDesc').textContent(), /第3步.*模態/, 'SVG description follows selected theory step');
  const pauseTransition = await page.evaluate(() => {
    const beam = document.querySelector('#storyBeam3');
    const before = beam.getAttribute('d');
    document.querySelector('#theoryMotion').click();
    return { before, after: beam.getAttribute('d') };
  });
  assert.equal(pauseTransition.after, pauseTransition.before, 'theory pause freezes the current frame without a jump');
  await page.waitForTimeout(250);
  const theoryPausedLater = await page.locator('#storyBeam3').getAttribute('d');
  assert.equal(theoryPausedLater, pauseTransition.after, 'theory pause keeps visual state stable');
  assert.equal(await page.locator('#theoryMotion').textContent(), '播放示意', 'theory pause action label updates');
  await page.locator('#theoryMotion').click();
  await page.locator('#theoryAuto').click();
  assert.equal(await page.evaluate(() => window.__THEORY_EXPLAINER__.autoPlaying), true, 'theory autoplay starts');
  await page.locator('#story-tab-3').focus();
  await page.waitForFunction(() => window.__THEORY_EXPLAINER__.step === 1, null, { timeout: 6000 });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'story-tab-1', 'autoplay keeps focused tab synchronized with selection');
  await page.locator('#theoryMotion').click();
  assert.equal(await page.evaluate(() => !window.__THEORY_EXPLAINER__.autoPlaying && !window.__THEORY_EXPLAINER__.motionRunning), true, 'manual pause also stops autoplay');
  assert.match(await page.locator('#theoryStatus').textContent(), /暫停/, 'manual pause announces the combined stopped state');
  await page.locator('#theoryMotion').click();
  await page.locator('#theoryAuto').click();
  await page.locator('#theoryAuto').click();
  assert.equal(await page.evaluate(() => !window.__THEORY_EXPLAINER__.autoPlaying && window.__THEORY_EXPLAINER__.motionRunning), true, 'stopping autoplay restores the prior running motion state');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !window.__THEORY_EXPLAINER__.motionRunning, null, { timeout: 1000 });
  assert.match(await page.locator('#theoryStatus').textContent(), /減少動態/, 'live reduced-motion preference change is announced');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.evaluate(() => window.__THEORY_EXPLAINER__.motionRunning), false, 'leaving reduced motion does not unexpectedly restart animation');

  const base = await getFrequency();
  await setRange('length', 12);
  const doubledLength = await getFrequency();
  assert.ok(Math.abs(doubledLength / base - 0.25) < 0.001, 'L doubled -> f quarter');
  await page.waitForTimeout(360);
  assert.match(await page.locator('#resultAnnouncement').textContent(), /27\.55.*赫茲/, 'live result announces recalculated frequency');
  await setRange('length', 6);
  await setRange('thickness', 1);
  const doubledThickness = await getFrequency();
  assert.ok(Math.abs(doubledThickness / base - 2) < 0.001, 'h doubled -> f doubled');
  await setRange('thickness', 0.5);
  await setRange('width', 60);
  const doubledWidth = await getFrequency();
  assert.ok(Math.abs(doubledWidth / base - 1) < 0.001, 'width cancels');
  await setRange('amplitude', 20);
  const changedAmplitude = await getFrequency();
  assert.ok(Math.abs(changedAmplitude / base - 1) < 0.001, 'amplitude does not change eigenfrequency');
  await page.locator('#mode').selectOption('2');
  const secondMode = await getFrequency();
  assert.ok(Math.abs(secondMode / base - 6.2669) < 0.002, 'second mode ratio');
  assert.equal(await page.locator('#workedModeLabel').textContent(), '代入第2模態', 'worked-example label follows selected mode');
  assert.match(await page.locator('#workedSubstitution').textContent(), /模態2/, 'worked-example value follows selected mode');
  await page.locator('#mode').selectOption('1');
  await page.locator('#model').selectOption('rotary-ritz');
  const correctedExact = await page.evaluate(() => ({
    corrected: window.__SINGING_RULER__.snapshot.frequencyHz,
    eb: window.__SINGING_RULER__.snapshot.ebFrequencyHz,
    q: window.__SINGING_RULER__.snapshot.rotaryCoefficientQ,
  }));
  const corrected = correctedExact.corrected;
  assert.ok(correctedExact.corrected < correctedExact.eb, 'Rayleigh–Ritz rotary correction lowers frequency');
  assert.ok(Math.abs(correctedExact.q - 4.647778318679) < 1e-10, 'Rayleigh–Ritz uses integrated Q1');
  assert.match(await page.locator('#slopeLabel').textContent(), /^EB斜率/, 'chart slope remains EB baseline');
  assert.match(await page.locator('#chartDesc').textContent(), /固定使用Euler–Bernoulli模型/, 'chart description remains EB baseline');
  await page.locator('#model').selectOption('eb');
  await page.locator('#material').selectOption('custom');
  assert.equal(await page.locator('.custom-material').isVisible(), true, 'custom material controls visible');
  assert.equal(await page.locator('#young').isEnabled(), true);
  await page.locator('#material').selectOption('stainless');
  assert.equal(await page.locator('.custom-material').isHidden(), true, 'custom material controls hidden');

  await page.locator('#reset').click();
  assert.ok(Math.abs((await getFrequency()) - 110.20) < 0.01, 'reset restores default');
  assert.equal(await page.locator('#forceMetric').textContent(), '4.19', '5 mm release force is correct');
  await page.locator('#playTone').click();
  await page.waitForFunction(() => document.querySelector('#audioStatus').textContent.includes('已播放'), null, { timeout: 3000 });
  assert.match(await page.locator('#audioStatus').textContent(), /110\.20 Hz/, 'Web Audio plays the theoretical default tone');
  await page.locator('#playTone').click();
  await page.waitForTimeout(100);
  await page.locator('#stopTone').click();
  await page.waitForTimeout(1350);
  assert.match(await page.locator('#audioStatus').textContent(), /^聲音已停止/, 'manual stop status is not overwritten by oscillator ended event');
  const pathBefore = await page.locator('#rulerPath').getAttribute('d');
  await page.locator('#toggleMotion').click();
  await page.waitForTimeout(250);
  const pathPaused1 = await page.locator('#rulerPath').getAttribute('d');
  await page.waitForTimeout(250);
  const pathPaused2 = await page.locator('#rulerPath').getAttribute('d');
  assert.equal(pathPaused1, pathPaused2, 'pause keeps visual state stable');
  assert.notEqual(pathBefore, '', 'ruler path exists');

  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main', 'skip link moves focus to main');

  await page.locator('a[href="#lab"]').first().click();
  await page.waitForFunction(() => {
    const header = document.querySelector('.site-header').getBoundingClientRect().height;
    const top = document.querySelector('#lab').getBoundingClientRect().top;
    return top >= header - 1;
  }, null, { timeout: 2500 });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'lab', 'hash navigation moves focus');
  const headerHeight = await page.locator('.site-header').evaluate((x) => x.getBoundingClientRect().height);
  const labTop = await page.locator('#lab').evaluate((x) => x.getBoundingClientRect().top);
  assert.ok(labTop >= headerHeight - 1, 'hash target clears sticky header');

  report.interactions = { theoryTabs: true, theoryKeyboard: true, theoryFocusSync: true, theoryForceDirection: true, theoryPauseStable: true, theoryAutoplay: true, theoryLivePreferenceChange: true, baseHz: base, doubledLengthHz: doubledLength, doubledThicknessHz: doubledThickness, secondModeHz: secondMode, rotaryRitzHz: corrected, liveResult: true, audioPlayback: true, audioStopStable: true, pauseStable: true, skipFocus: true, hashFocus: true };
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  const { page: desktopPage } = await loadPage(desktop, 'desktop');
  await structuralChecks(desktopPage, 'desktop', 1440, false);
  await interactionChecks(desktopPage);
  await desktopPage.screenshot({ path: `${outDir}/desktop.png`, fullPage: true });
  await desktopPage.locator('#story-tab-3').click();
  await desktopPage.locator('.theory-story').screenshot({ path: `${outDir}/desktop-step3.png` });
  await desktop.close();

  const medium = await browser.newContext({ viewport: { width: 1024, height: 900 }, reducedMotion: 'no-preference' });
  const { page: mediumPage } = await loadPage(medium, 'medium1024');
  await structuralChecks(mediumPage, 'medium1024', 1024, false);
  await mediumPage.screenshot({ path: `${outDir}/medium1024.png`, fullPage: true });
  await mediumPage.locator('#story-tab-3').click();
  await mediumPage.locator('.theory-story').screenshot({ path: `${outDir}/medium1024-step3.png` });
  await medium.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  const { page: mobilePage } = await loadPage(mobile, 'mobile390');
  await structuralChecks(mobilePage, 'mobile390', 390, true);
  await mobilePage.screenshot({ path: `${outDir}/mobile390.png`, fullPage: true });
  await mobilePage.locator('#story-tab-3').click();
  await mobilePage.locator('.theory-story').screenshot({ path: `${outDir}/mobile390-step3.png` });
  await mobile.close();

  const narrow = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: 'no-preference' });
  const { page: narrowPage } = await loadPage(narrow, 'narrow320');
  await structuralChecks(narrowPage, 'narrow320', 320, true);
  await narrowPage.screenshot({ path: `${outDir}/narrow320.png`, fullPage: true });
  await narrowPage.locator('#story-tab-3').click();
  await narrowPage.locator('.theory-story').screenshot({ path: `${outDir}/narrow320-step3.png` });
  await narrow.close();

  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const { page: reducedPage } = await loadPage(reduced, 'reduced-motion');
  assert.equal(await reducedPage.locator('#toggleMotion').textContent(), '繼續動畫');
  assert.equal(await reducedPage.evaluate(() => window.__SINGING_RULER__.running), false);
  assert.equal(await reducedPage.locator('#theoryMotion').textContent(), '播放示意');
  assert.equal(await reducedPage.evaluate(() => window.__THEORY_EXPLAINER__.motionRunning), false);
  await reducedPage.locator('#theoryAuto').click();
  assert.equal(await reducedPage.evaluate(() => window.__THEORY_EXPLAINER__.autoPlaying && window.__THEORY_EXPLAINER__.motionRunning), true, 'explicit theory autoplay overrides reduced motion');
  await reducedPage.locator('#theoryAuto').click();
  assert.equal(await reducedPage.evaluate(() => !window.__THEORY_EXPLAINER__.autoPlaying && !window.__THEORY_EXPLAINER__.motionRunning), true, 'stopping autoplay restores reduced-motion pause');
  const reducedStopped1 = await reducedPage.locator('#storyBeam1').getAttribute('d');
  await reducedPage.waitForTimeout(250);
  const reducedStopped2 = await reducedPage.locator('#storyBeam1').getAttribute('d');
  assert.equal(reducedStopped1, reducedStopped2, 'reduced-motion visual stays still after autoplay stops');
  report.interactions.reducedMotionStartsPaused = true;
  report.interactions.reducedMotionTheoryOptIn = true;
  await reduced.close();

  await fs.writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: 'PASS', url: baseURL, viewports: Object.keys(report.viewports), interactions: report.interactions, axe: report.axe }, null, 2));
} finally {
  await browser.close();
}
