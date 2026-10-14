// Service worker: owns recording / playback state and drives playback across
// page loads and frames. Content scripts (one per frame) do the DOM work.

import { getSettings, getScripts, upsertScript, uid } from './shared/storage.js';
import { describeStep } from './shared/steps.js';
import { isRecordableUrl } from './shared/scope.js';

const CONTENT_FILE = 'src/content/content.js';

// ---------------------------------------------------------------------------
// State. Kept in chrome.storage.session so an active recording survives the
// service worker being suspended. Playback can't survive a restart (its loop
// lives in memory), so any stale playback is cleared on load.
// ---------------------------------------------------------------------------

let state;
const stateReady = chrome.storage.session.get('am_state').then(({ am_state }) => {
  state = am_state || {};
  state.recording ??= null; // { tabId, startUrl, steps, lastTime }
  state.pending ??= null;   // { startUrl, steps, stoppedAt } — stopped, not yet saved
  state.playback = null;    // { tabId, scriptId, name, index, total }
  state.lastResult ??= null;
});

let playbackCtl = null; // { aborted } for the running playback

async function getState() {
  await stateReady;
  return state;
}

function persist() {
  return chrome.storage.session.set({ am_state: state });
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------

function notifyPopup() {
  chrome.runtime.sendMessage({ type: 'am:stateChanged' }).catch(() => {});
}

async function contentState(tabId) {
  const s = await getState();
  const settings = await getSettings();
  return {
    recording: !!s.recording && s.recording.tabId === tabId,
    stepCount: s.recording?.steps.length ?? 0,
    playing:
      s.playback && s.playback.tabId === tabId
        ? { name: s.playback.name, index: s.playback.index, total: s.playback.total }
        : null,
    recordPasswords: settings.recordPasswords,
    showOverlay: settings.showOverlay
  };
}

async function notifyTab(tabId, extra = {}) {
  if (tabId == null) return;
  const cs = await contentState(tabId);
  chrome.tabs.sendMessage(tabId, { type: 'am:state', state: { ...cs, ...extra } }).catch(() => {});
}

async function updateBadge() {
  const s = await getState();
  let text = '';
  let color = '#666';
  if (s.recording) {
    text = 'REC';
    color = '#d93025';
  } else if (s.playback) {
    text = `${s.playback.index}/${s.playback.total}`;
    color = '#188038';
  } else if (s.pending) {
    text = 'SAVE';
    color = '#e37400';
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function changed(tabId) {
  await persist();
  notifyPopup();
  await updateBadge();
  if (tabId != null) await notifyTab(tabId);
}

// Makes sure our content script is present in every frame of the tab (tabs that
// were open before the extension was installed/reloaded won't have it).
async function ensureInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'am:frameInfo' }, { frameId: 0 });
    return;
  } catch {}
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_FILE] });
  } catch (e) {
    throw new Error(`Can't access this page (${e.message}).`);
  }
}

const sleep = (ms, ctl) =>
  new Promise(resolve => {
    if (ms <= 0) return resolve();
    const start = Date.now();
    const tick = () => {
      if (ctl?.aborted || Date.now() - start >= ms) resolve();
      else setTimeout(tick, Math.min(100, ms - (Date.now() - start)));
    };
    tick();
  });

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

async function startRecording(tabId) {
  const s = await getState();
  if (s.playback) throw new Error('A script is currently playing.');
  if (s.recording) throw new Error('Already recording.');
  if (s.pending) throw new Error('Save or discard the previous recording first.');
  const tab = await chrome.tabs.get(tabId);
  if (!isRecordableUrl(tab.url)) throw new Error("This page can't be recorded.");
  await ensureInjected(tabId);
  s.recording = { tabId, startUrl: tab.url, steps: [], lastTime: Date.now() };
  s.lastResult = null;
  await changed(tabId);
  return { ok: true };
}

async function stopRecording({ openPopup = false } = {}) {
  const s = await getState();
  if (!s.recording) return { ok: true };
  const { tabId, startUrl, steps } = s.recording;
  s.recording = null;
  s.pending = steps.length ? { startUrl, steps, stoppedAt: Date.now() } : null;
  await changed(tabId);
  if (openPopup && s.pending) {
    // Stopped from the in-page overlay or keyboard shortcut: open the popup so
    // the user can name and save. Falls back to the "SAVE" badge if not allowed.
    chrome.action.openPopup?.().catch(() => {});
  }
  return { ok: true, stepCount: steps.length };
}

async function cancelRecording() {
  const s = await getState();
  const tabId = s.recording?.tabId;
  s.recording = null;
  await changed(tabId);
  return { ok: true };
}

function sameTarget(a, b) {
  return (
    JSON.stringify(a.frame?.path) === JSON.stringify(b.frame?.path) &&
    a.target?.selectors?.[0] === b.target?.selectors?.[0]
  );
}

// Steps whose latest value supersedes an immediately preceding step on the same
// element (typing is reported per keystroke; we keep only the final value).
const MERGEABLE = new Set(['type', 'select', 'check']);

async function recordStep(sender, step) {
  const s = await getState();
  const rec = s.recording;
  if (!rec || sender.tab?.id !== rec.tabId) return { ok: false };
  const now = Date.now();
  const last = rec.steps[rec.steps.length - 1];
  if (last && MERGEABLE.has(step.action) && last.action === step.action && sameTarget(last, step)) {
    Object.assign(last, step, { id: last.id, delay: last.delay });
  } else {
    rec.steps.push({ ...step, id: uid(), delay: now - rec.lastTime });
  }
  rec.lastTime = now;
  await changed(rec.tabId);
  return { ok: true };
}

// Navigations the user makes outside the page (address bar, bookmarks, reload,
// back/forward) become explicit steps; link clicks and form submits don't,
// because replaying the click reproduces them.
chrome.webNavigation.onCommitted.addListener(async d => {
  if (d.frameId !== 0) return;
  const s = await getState();
  const rec = s.recording;
  if (!rec || d.tabId !== rec.tabId) return;
  const typed = ['typed', 'auto_bookmark', 'keyword', 'generated', 'reload', 'start_page'];
  const q = d.transitionQualifiers || [];
  if (typed.includes(d.transitionType) || q.includes('from_address_bar') || q.includes('forward_back')) {
    const now = Date.now();
    rec.steps.push({ id: uid(), action: 'navigate', url: d.url, delay: now - rec.lastTime });
    rec.lastTime = now;
    await changed(rec.tabId);
  }
});

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function urlKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url || '';
  }
}

async function waitForTabComplete(tabId, timeout, ctl) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !ctl?.aborted) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await sleep(100, ctl);
  }
}

// Finds the frameId whose content script best matches the recorded frame:
// same position in the frame tree AND same URL beats same URL beats same position.
async function resolveFrame(tabId, frame, deadline, ctl) {
  const wantPath = JSON.stringify(frame?.path || []);
  const wantUrl = urlKey(frame?.url);
  while (!ctl.aborted) {
    if (wantPath === '[]') {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'am:frameInfo' }, { frameId: 0 });
        return 0;
      } catch {}
    } else {
      const frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
      const infos = await Promise.all(
        frames.map(f =>
          chrome.tabs
            .sendMessage(tabId, { type: 'am:frameInfo' }, { frameId: f.frameId })
            .then(info => info && { frameId: f.frameId, ...info })
            .catch(() => null)
        )
      );
      let best = null;
      let bestScore = 0;
      for (const info of infos) {
        if (!info) continue;
        const pathEq = JSON.stringify(info.path) === wantPath;
        const urlEq = urlKey(info.url) === wantUrl;
        const score = pathEq && urlEq ? 3 : urlEq ? 2 : pathEq ? 1 : 0;
        if (score > bestScore) {
          best = info;
          bestScore = score;
        }
      }
      if (best) return best.frameId;
    }
    if (Date.now() > deadline) break;
    await sleep(250, ctl);
  }
  throw new Error(`Frame not found (${frame?.url || 'top page'})`);
}

function delayBefore(step, index, settings) {
  if (index === 0) return 0;
  if (settings.timingMode === 'recorded') {
    const d = Math.min(step.delay || 0, settings.maxRecordedDelay);
    return d / Math.max(0.1, settings.speedMultiplier);
  }
  return settings.stepDelay;
}

async function runStep(tabId, step, settings, ctl) {
  if (step.action === 'wait') return sleep(Number(step.ms) || 0, ctl);
  if (step.action === 'navigate') {
    await chrome.tabs.update(tabId, { url: step.url });
    await sleep(300, ctl);
    await waitForTabComplete(tabId, settings.elementTimeout, ctl);
    return;
  }

  const deadline = Date.now() + settings.elementTimeout;
  for (;;) {
    const frameId = await resolveFrame(tabId, step.frame, deadline, ctl);
    if (ctl.aborted) return;
    try {
      const res = await chrome.tabs.sendMessage(
        tabId,
        { type: 'am:exec', step, settings, timeout: Math.max(1000, deadline - Date.now()) },
        { frameId }
      );
      if (res?.ok) return;
      throw new Error(res?.error || 'No response from page');
    } catch (e) {
      const msg = e.message || String(e);
      // The page navigated away as a result of this step — that's success.
      if (/message port closed|back\/forward cache/i.test(msg) && (step.action === 'click' || step.action === 'key')) return;
      // The frame disappeared between resolving and executing; retry.
      if (/Receiving end does not exist|Could not establish connection/i.test(msg) && Date.now() < deadline) {
        await sleep(250, ctl);
        continue;
      }
      throw e;
    }
  }
}

// Validates and claims the playback slot; throws if playback can't start.
async function startPlayback(tabId, scriptId) {
  const s = await getState();
  if (s.playback) throw new Error('A script is already playing.');
  if (s.recording) throw new Error('Stop recording first.');
  const script = (await getScripts()).find(x => x.id === scriptId);
  if (!script) throw new Error('Script not found.');
  if (!script.steps.length) throw new Error('This script has no steps.');
  const settings = await getSettings();
  await ensureInjected(tabId);
  if (s.playback) throw new Error('A script is already playing.');

  const ctl = { aborted: false };
  playbackCtl = ctl;
  s.lastResult = null;
  s.playback = { tabId, scriptId, name: script.name, index: 0, total: script.steps.length };
  await changed(tabId);
  return { tabId, script, settings, ctl };
}

async function runPlayback({ tabId, script, settings, ctl }) {
  const s = await getState();
  const errors = [];
  let fatal = null;
  try {
    for (let i = 0; i < script.steps.length; i++) {
      const step = script.steps[i];
      await sleep(delayBefore(step, i, settings), ctl);
      if (ctl.aborted) break;
      if (settings.waitForPageLoad) await waitForTabComplete(tabId, settings.elementTimeout, ctl);
      if (ctl.aborted) break;
      s.playback.index = i + 1;
      await changed(tabId);
      try {
        await runStep(tabId, step, settings, ctl);
      } catch (e) {
        const msg = `Step ${i + 1} (${describeStep(step)}): ${e.message || e}`;
        if (settings.onError === 'stop') throw new Error(msg);
        errors.push(msg);
      }
    }
  } catch (e) {
    fatal = e.message || String(e);
  } finally {
    s.lastResult = {
      scriptId: script.id,
      name: script.name,
      status: ctl.aborted ? 'stopped' : fatal ? 'failed' : errors.length ? 'partial' : 'done',
      error: fatal,
      errors,
      completed: s.playback?.index ?? 0,
      total: script.steps.length,
      at: Date.now()
    };
    s.playback = null;
    if (playbackCtl === ctl) playbackCtl = null;
    await changed(null);
    await notifyTab(tabId, { result: s.lastResult });
  }
}

async function stopPlayback() {
  if (playbackCtl) playbackCtl.aborted = true;
  const s = await getState();
  if (s.playback) {
    chrome.tabs.sendMessage(s.playback.tabId, { type: 'am:abort' }).catch(() => {});
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Popup / page API
// ---------------------------------------------------------------------------

async function publicState() {
  const s = await getState();
  return {
    recording: s.recording && {
      tabId: s.recording.tabId,
      startUrl: s.recording.startUrl,
      stepCount: s.recording.steps.length,
      steps: s.recording.steps
    },
    pending: s.pending,
    playback: s.playback,
    lastResult: s.lastResult
  };
}

async function savePending({ name, description, scope }) {
  const s = await getState();
  if (!s.pending) throw new Error('Nothing to save.');
  const now = Date.now();
  const script = await upsertScript({
    id: uid(),
    name: name?.trim() || 'Untitled script',
    description: description || '',
    scope,
    startUrl: s.pending.startUrl,
    createdAt: now,
    steps: s.pending.steps
  });
  s.pending = null;
  await changed(null);
  return { ok: true, script };
}

async function handle(msg, sender) {
  const s = await getState();
  switch (msg.type) {
    // From content scripts
    case 'am:hello':
      return contentState(sender.tab?.id);
    case 'am:recordStep':
      return recordStep(sender, msg.step);
    // From popup / overlay / manager
    case 'am:getState':
      return publicState();
    case 'am:startRecording':
      return startRecording(msg.tabId ?? sender.tab?.id);
    case 'am:stopRecording':
      return stopRecording({ openPopup: !!sender.tab });
    case 'am:cancelRecording':
      return cancelRecording();
    case 'am:savePending':
      return savePending(msg);
    case 'am:discardPending':
      s.pending = null;
      await changed(null);
      return { ok: true };
    case 'am:play': {
      const ctx = await startPlayback(msg.tabId, msg.scriptId);
      runPlayback(ctx); // outlives this message; progress is pushed via state updates
      return { ok: true };
    }
    case 'am:stopPlayback':
      return stopPlayback();
    case 'am:clearResult':
      s.lastResult = null;
      await changed(null);
      return { ok: true };
    default:
      return { ok: false, error: `Unknown message ${msg.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type?.startsWith('am:') || msg.type === 'am:stateChanged') return false;
  handle(msg, sender).then(
    res => sendResponse(res),
    err => sendResponse({ ok: false, error: err.message || String(err) })
  );
  return true;
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const s = await getState();
  if (s.recording?.tabId === tabId) await stopRecording();
  if (s.playback?.tabId === tabId) await stopPlayback();
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-recording') return;
  const s = await getState();
  if (s.recording) return stopRecording({ openPopup: true });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) startRecording(tab.id).catch(() => {});
});

chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
stateReady.then(updateBadge);
