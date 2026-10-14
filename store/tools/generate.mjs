// Generates Chrome Web Store images by driving the real extension:
//   cd store/tools && npm install && npm run assets
// Output: store/screenshots/*.png (1280x800) and store/promo/*.png
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDemoSite } from './demo-site.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// AM_ROOT lets the script run from a copy outside the repo (avoids installing node_modules here).
const EXT = path.resolve(process.env.AM_ROOT || path.resolve(here, '../..'));
const OUT_SHOTS = path.join(EXT, 'store/screenshots');
const OUT_PROMO = path.join(EXT, 'store/promo');
const HOST_PORT = 8721;
const FRAME_PORT = 8722;
const HOST_URL = `http://localhost:${HOST_PORT}/vendors/onboarding`;

fs.mkdirSync(OUT_SHOTS, { recursive: true });
fs.mkdirSync(OUT_PROMO, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = buf => 'data:image/png;base64,' + Buffer.from(buf).toString('base64');
const icon = b64(fs.readFileSync(path.join(EXT, 'icons/icon128.png')));

const stopSite = startDemoSite(HOST_PORT, FRAME_PORT);
const browser = await puppeteer.launch({
  headless: false,
  pipe: true,
  enableExtensions: [EXT],
  defaultViewport: null,
  args: ['--no-first-run', '--window-size=1400,1000', '--force-color-profile=srgb']
});

async function lightPage() {
  const p = await browser.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  return p;
}

try {
  const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background.js'));
  const extId = new URL(swTarget.url()).host;
  const extUrl = p => `chrome-extension://${extId}/${p}`;

  const page = await lightPage();
  // Short enough that the in-page indicator (bottom-right) fits in the composed frame.
  await page.setViewport({ width: 1280, height: 660 });
  await page.goto(HOST_URL);
  await sleep(500);

  const ctl = await lightPage();
  await ctl.goto(extUrl('src/manager/manager.html'));
  const send = msg => ctl.evaluate(m => chrome.runtime.sendMessage(m), msg);
  const tabId = await ctl.evaluate(async u => (await chrome.tabs.query({ url: u + '*' }))[0].id, `http://localhost:${HOST_PORT}/`);
  await ctl.evaluate(() => chrome.storage.local.clear());

  // The popup page loads in a background tab so the demo page is the "active
  // tab" it inspects; it's brought forward only for the capture (background
  // tabs don't paint, so screenshotting them can hang).
  const popup = await lightPage();
  async function popupShot() {
    await page.bringToFront();
    await popup.setViewport({ width: 360, height: 600 });
    await popup.goto(extUrl('src/popup/popup.html'));
    await sleep(600);
    return popupClip();
  }
  async function popupClip() {
    await popup.bringToFront();
    await sleep(150);
    const body = await popup.$('body');
    const box = await body.boundingBox();
    return popup.screenshot({ clip: { x: 0, y: 0, width: 360, height: Math.ceil(box.height) } });
  }
  async function pageShot() {
    await page.bringToFront();
    await sleep(150);
    return page.screenshot();
  }

  // --- Record ---------------------------------------------------------------
  await send({ type: 'am:startRecording', tabId });
  await page.bringToFront();
  await page.click('#start');
  const frame = await (await page.waitForSelector('iframe#vendor')).contentFrame();
  await frame.waitForSelector('input[name=company]');
  await sleep(800);
  await frame.type('input[name=company]', 'Globex Supply Co.', { delay: 5 });
  await frame.type('input[name=email]', 'ap@globex-supply.test', { delay: 5 });
  await frame.type('input[name=taxId]', '12-3456789', { delay: 5 });
  await frame.focus('select[name=country]');
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  const recPage = await pageShot();
  const recPopup = await popupShot();

  await page.bringToFront();
  await frame.focus('select[name=terms]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await frame.type('input[name=routing]', '021000021', { delay: 5 });
  await frame.type('textarea[name=notes]', 'Created by QA regression script', { delay: 5 });
  await frame.click('label.chk');
  await frame.click('[data-testid=submit-vendor]');
  await sleep(400);
  await send({ type: 'am:stopRecording' });
  const savePage = await pageShot();
  await popupShot();
  await popup.$eval('#save-name', el => (el.value = 'Vendor onboarding – full form'));
  await popup.$eval('#save-desc', el => (el.value = 'Fills and submits the vendor form with valid US data.'));
  const savePopup = await popupClip();
  const saved = await send({
    type: 'am:savePending',
    name: 'Vendor onboarding – full form',
    description: 'Fills and submits the vendor form with valid US data.',
    scope: { type: 'host', value: `localhost:${HOST_PORT}` }
  });
  // A couple of extra scripts so the list looks like real use.
  await ctl.evaluate(async base => {
    const { scripts } = await chrome.storage.local.get('scripts');
    const mk = (name, n, desc) => ({ ...base, id: crypto.randomUUID(), name, description: desc, steps: base.steps.slice(0, n) });
    scripts.push(mk('Vendor onboarding – missing tax ID', 3, 'Triggers the validation error path.'));
    scripts.push(mk('Open onboarding form', 1, ''));
    await chrome.storage.local.set({ scripts });
  }, saved.script);

  // --- Script list for this site -----------------------------------------------
  await page.goto(HOST_URL);
  await sleep(600);
  const listPage = await pageShot();
  const listPopup = await popupShot();

  // --- Playback in progress -----------------------------------------------------
  await ctl.evaluate(() => chrome.storage.local.set({ settings: { typingDelay: 70, stepDelay: 500 } }));
  await page.bringToFront();
  await send({ type: 'am:play', tabId, scriptId: saved.script.id });
  let playPage;
  let playBadge = '';
  for (let i = 0; i < 200; i++) {
    const s = await send({ type: 'am:getState' });
    if (s.playback?.index === 6) {
      await sleep(350);
      playPage = await page.screenshot();
      playBadge = `${s.playback.index}/${s.playback.total}`;
      break;
    }
    await sleep(50);
  }
  for (let i = 0; i < 200; i++) {
    const s = await send({ type: 'am:getState' });
    if (!s.playback) break;
    await sleep(200);
  }
  await send({ type: 'am:clearResult' });

  // --- Manager -----------------------------------------------------------------
  const mgr = await lightPage();
  await mgr.setViewport({ width: 1280, height: 660 });
  await mgr.goto(extUrl(`src/manager/manager.html#edit/${saved.script.id}`));
  await sleep(600);
  await mgr.evaluate(() => window.scrollTo(0, 290));
  await sleep(200);
  const editorShot = await mgr.screenshot();

  // --- Compose ------------------------------------------------------------------
  const composer = await lightPage();
  await composer.setViewport({ width: 1280, height: 800 });

  async function render(html, file, w, h) {
    await composer.setViewport({ width: w, height: h });
    await composer.setContent(html, { waitUntil: 'load' });
    await composer.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h } });
    console.log('wrote', path.relative(EXT, file));
  }

  const baseCss = `
    * { box-sizing: border-box; margin: 0; }
    body { width: 1280px; height: 800px; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #1e3a5f 100%); color: #fff; position: relative; }
    .cap { position: absolute; left: 56px; top: 34px; right: 56px; }
    .cap h1 { font-size: 34px; font-weight: 700; letter-spacing: -.5px; }
    .cap p { font-size: 17px; color: #cbd5e1; margin-top: 6px; }
    .win { position: absolute; left: 56px; top: 140px; width: 1168px; border-radius: 12px; overflow: hidden;
      box-shadow: 0 30px 60px rgba(0,0,0,.45); background: #fff; }
    .bar { height: 44px; background: #dee1e6; display: flex; align-items: center; gap: 10px; padding: 0 14px; }
    .dots i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; background: #c4c7cc; }
    .url { flex: 1; height: 30px; border-radius: 15px; background: #fff; color: #3c4043; font-size: 14px; display: flex; align-items: center; padding: 0 14px; }
    .ext { position: relative; width: 30px; height: 30px; display: grid; place-items: center; }
    .ext img { width: 20px; height: 20px; }
    .badge { position: absolute; right: -8px; bottom: -3px; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 4px; color: #fff; }
    .shot { display: block; width: 1168px; }
    .popup { position: absolute; border-radius: 10px; overflow: hidden; box-shadow: 0 18px 40px rgba(0,0,0,.4); border: 1px solid #c4c7cc; }
    .popup img { display: block; width: 100%; }
  `;
  const browserFrame = ({ shot, url, badge, badgeColor = '#d93025', popupImg, popupWidth = 340 }) => `
    <div class="win">
      <div class="bar"><span class="dots"><i></i><i></i><i></i></span>
        <span class="url">${url}</span>
        <span class="ext"><img src="${icon}">${badge ? `<span class="badge" style="background:${badgeColor}">${badge}</span>` : ''}</span>
      </div>
      <img class="shot" src="${b64(shot)}">
    </div>
    ${popupImg ? `<div class="popup" style="right: 64px; top: 182px; width: ${popupWidth}px;"><img src="${b64(popupImg)}"></div>` : ''}`;

  const shot = (title, sub, inner) =>
    `<html><head><style>${baseCss}</style></head><body><div class="cap"><h1>${title}</h1><p>${sub}</p></div>${inner}</body></html>`;

  const pretty = HOST_URL.replace('http://', '');
  await render(
    shot('Record real QA steps as you click', 'Clicks, typing, dropdowns and checkboxes are captured, including inside cross-origin iframes.',
      browserFrame({ shot: recPage, url: pretty, badge: 'REC', popupImg: recPopup })),
    path.join(OUT_SHOTS, '1-record.png'), 1280, 800);
  await render(
    shot('Save it to the site it belongs to', 'Scope a script to a host, a domain, a single page, a URL prefix or a regex.',
      browserFrame({ shot: savePage, url: pretty, badge: 'SAVE', badgeColor: '#e37400', popupImg: savePopup })),
    path.join(OUT_SHOTS, '2-save.png'), 1280, 800);
  await render(
    shot('Run it again with one click', 'The popup lists only the scripts saved for the site you are on.',
      browserFrame({ shot: listPage, url: pretty, popupImg: listPopup })),
    path.join(OUT_SHOTS, '3-run.png'), 1280, 800);
  await render(
    shot('Watch it fill the form for you', 'Each element is highlighted as it is clicked or filled, at the speed you choose.',
      browserFrame({ shot: playPage, url: pretty, badge: playBadge, badgeColor: '#188038' })),
    path.join(OUT_SHOTS, '4-playback.png'), 1280, 800);
  await render(
    shot('Change the test data without re-recording', 'Edit values and selectors, reorder steps, and export scripts to share with your team.',
      browserFrame({ shot: editorShot, url: `Action Mimic · Scripts` })),
    path.join(OUT_SHOTS, '5-edit.png'), 1280, 800);
  // The Web Store accepts at most 5 screenshots.

  // Promo tiles
  const promoCss = (w, h) => `
    * { margin: 0; box-sizing: border-box; }
    body { width: ${w}px; height: ${h}px; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif; color: #fff;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #1e3a5f 100%); }`;
  await render(`<html><head><style>${promoCss(440, 280)}
    .c { height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 0 34px; gap: 10px; }
    .t { display: flex; align-items: center; gap: 14px; } img { width: 64px; height: 64px; }
    h1 { font-size: 34px; letter-spacing: -.5px; } p { font-size: 17px; color: #cbd5e1; line-height: 1.35; }
    </style></head><body><div class="c"><div class="t"><img src="${icon}"><h1>Action Mimic</h1></div>
    <p>Record QA steps once.<br>Replay them on any page in one click.</p></div></body></html>`,
    path.join(OUT_PROMO, 'small-promo-440x280.png'), 440, 280);
  await render(`<html><head><style>${promoCss(1400, 560)}
    .l { position: absolute; left: 80px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
    .t { display: flex; align-items: center; gap: 18px; } .t img { width: 84px; height: 84px; }
    h1 { font-size: 52px; letter-spacing: -1px; } p { font-size: 24px; color: #cbd5e1; line-height: 1.4; }
    .shot { position: absolute; left: 700px; top: 70px; width: 820px; border-radius: 12px; box-shadow: 0 30px 60px rgba(0,0,0,.5); }
    .pop { position: absolute; left: 1080px; top: 110px; width: 270px; border-radius: 10px; box-shadow: 0 18px 40px rgba(0,0,0,.45); }
    </style></head><body><div class="l"><div class="t"><img src="${icon}"><h1>Action Mimic</h1></div>
    <p>Record repeatable QA steps, scope them to a site, and replay them in one click, even inside iframes.</p></div>
    <img class="shot" src="${b64(listPage)}"><img class="pop" src="${b64(listPopup)}"></body></html>`,
    path.join(OUT_PROMO, 'marquee-promo-1400x560.png'), 1400, 560);

  // Store icon: the 128px icon on a transparent canvas (already compliant), copied for convenience.
  fs.copyFileSync(path.join(EXT, 'icons/icon128.png'), path.join(OUT_PROMO, 'store-icon-128.png'));
} finally {
  await browser.close();
  stopSite();
}
