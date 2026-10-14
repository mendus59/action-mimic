// All persistence goes through chrome.storage.local — nothing leaves the device
// except via an explicit, user-initiated export.

export const EXPORT_FORMAT = 'action-mimic';
export const EXPORT_VERSION = 1;

export const DEFAULT_SETTINGS = {
  // Playback pacing
  timingMode: 'fixed',        // 'fixed' = stepDelay between steps, 'recorded' = original pauses
  stepDelay: 400,             // ms between steps in fixed mode
  speedMultiplier: 1,         // recorded mode: 2 = twice as fast
  maxRecordedDelay: 5000,     // recorded mode: cap on any single pause (ms)
  typingDelay: 25,            // ms per character; 0 = fill fields instantly
  // Playback behavior
  elementTimeout: 10000,      // how long to wait for an element / frame / page load (ms)
  waitForPageLoad: true,      // wait for the tab to finish loading before each step
  highlight: true,            // flash the element being acted on
  onError: 'stop',            // 'stop' | 'skip'
  // Recording behavior
  recordPasswords: false,     // when false, password values are left blank for you to fill in
  showOverlay: true           // floating in-page REC / playback indicator
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(partial) {
  const next = { ...(await getSettings()), ...partial };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function resetSettings() {
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
  return { ...DEFAULT_SETTINGS };
}

export async function getScripts() {
  const { scripts } = await chrome.storage.local.get('scripts');
  return Array.isArray(scripts) ? scripts : [];
}

export async function setScripts(scripts) {
  await chrome.storage.local.set({ scripts });
}

export async function getScript(id) {
  return (await getScripts()).find(s => s.id === id) || null;
}

export async function upsertScript(script) {
  const scripts = await getScripts();
  const i = scripts.findIndex(s => s.id === script.id);
  const saved = { ...script, updatedAt: Date.now() };
  if (i >= 0) scripts[i] = saved;
  else scripts.push(saved);
  await setScripts(scripts);
  return saved;
}

export async function deleteScript(id) {
  await setScripts((await getScripts()).filter(s => s.id !== id));
}

export function uid() {
  return crypto.randomUUID();
}

export function buildExport(scripts) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    scripts
  };
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Parses an export file and returns validated scripts. Throws with a readable message.
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  const list = Array.isArray(data) ? data : data?.scripts;
  if (!Array.isArray(list)) throw new Error('No scripts found in file.');
  if (!Array.isArray(data) && data.format && data.format !== EXPORT_FORMAT) {
    throw new Error(`Unrecognized format "${data.format}".`);
  }
  return list.map((s, i) => {
    if (!s || typeof s !== 'object' || !Array.isArray(s.steps)) {
      throw new Error(`Script #${i + 1} is malformed (missing steps).`);
    }
    return {
      id: typeof s.id === 'string' ? s.id : uid(),
      name: String(s.name || `Imported script ${i + 1}`),
      description: String(s.description || ''),
      scope: s.scope && typeof s.scope.type === 'string' ? s.scope : { type: 'global', value: '' },
      startUrl: String(s.startUrl || ''),
      createdAt: Number(s.createdAt) || Date.now(),
      updatedAt: Number(s.updatedAt) || Date.now(),
      steps: s.steps.map(step => ({ ...step, id: step.id || uid() }))
    };
  });
}
