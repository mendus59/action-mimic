// Runs in every frame (including cross-origin iframes). Each frame records its
// own events and executes playback steps addressed to it by the background.
(() => {
  if (window.__actionMimicLoaded) return;
  window.__actionMimicLoaded = true;

  const isTop = window === window.top;
  let recording = false;
  let recordPasswords = false;
  let abortToken = 0;

  // -------------------------------------------------------------------------
  // Frame identity: index path from the top window, e.g. [1, 0] = first iframe
  // inside the second iframe. window.parent.frames is readable cross-origin.
  // -------------------------------------------------------------------------

  function framePath() {
    const path = [];
    let w = window;
    try {
      while (w !== w.top) {
        const p = w.parent;
        let idx = -1;
        for (let i = 0; i < p.frames.length; i++) {
          if (p.frames[i] === w) {
            idx = i;
            break;
          }
        }
        path.unshift(idx);
        w = p;
      }
    } catch {}
    return path;
  }

  const frameInfo = () => ({ path: framePath(), url: location.href });

  // -------------------------------------------------------------------------
  // Selectors. Each target stores several candidate selectors (most stable
  // first) plus text as a last-resort fallback. Elements inside open shadow
  // roots are addressed as "host-selector >>> inner-selector".
  // -------------------------------------------------------------------------

  const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-automation-id', 'data-e2e'];
  const SHADOW_SEP = ' >>> ';

  function looksGenerated(v) {
    return (
      /^\d/.test(v) ||
      /\d{4,}/.test(v) ||
      /[a-f0-9]{8,}/i.test(v) ||
      /^(:r|ember|react-|mui-|radix-|headlessui-)/i.test(v) ||
      /[_-][a-z0-9]{5,}$/i.test(v) && /\d/.test(v)
    );
  }

  const esc = v => CSS.escape(v);
  const attrSel = (name, value) => `[${name}="${String(value).replace(/["\\]/g, '\\$&')}"]`;

  function uniqueIn(root, sel, el) {
    try {
      const m = root.querySelectorAll(sel);
      return m.length === 1 && m[0] === el;
    } catch {
      return false;
    }
  }

  function cssPath(el, root) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== root) {
      const tag = node.localName;
      if (node.id && !looksGenerated(node.id) && uniqueIn(root, '#' + esc(node.id), node)) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      const parent = node.parentElement || node.parentNode;
      let part = tag;
      if (parent && parent.children) {
        const same = Array.from(parent.children).filter(c => c.localName === tag);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (!node.parentElement) break;
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // Candidate selectors for el within its own root (document or shadow root).
  function localSelectors(el) {
    const root = el.getRootNode();
    const tag = el.localName;
    const out = [];
    const add = sel => {
      if (out.length < 4 && !out.includes(sel) && uniqueIn(root, sel, el)) out.push(sel);
    };
    for (const a of TEST_ATTRS) {
      const v = el.getAttribute(a);
      if (v) add(attrSel(a, v));
    }
    if (el.id && !looksGenerated(el.id)) add('#' + esc(el.id));
    const name = el.getAttribute('name');
    if (name) {
      add(`${tag}${attrSel('name', name)}`);
      const form = el.closest('form');
      if (form?.id && !looksGenerated(form.id)) add(`#${esc(form.id)} ${tag}${attrSel('name', name)}`);
    }
    for (const a of ['aria-label', 'placeholder', 'title', 'alt']) {
      const v = el.getAttribute(a);
      if (v) add(`${tag}${attrSel(a, v)}`);
    }
    if (tag === 'input' && el.type && (el.type === 'submit' || el.type === 'button') && el.value) {
      add(`input${attrSel('type', el.type)}${attrSel('value', el.value)}`);
    }
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href && !href.startsWith('javascript:') && href !== '#') add(`a${attrSel('href', href)}`);
    }
    const path = cssPath(el, root);
    if (path && !out.includes(path)) out.push(path);
    return out;
  }

  function hostChain(el) {
    const chain = [];
    let root = el.getRootNode();
    while (root instanceof ShadowRoot) {
      const host = root.host;
      chain.unshift(localSelectors(host)[0]);
      root = host.getRootNode();
    }
    return chain;
  }

  function visibleText(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // A <label>'s text without the text of the controls nested inside it
  // (otherwise a wrapped <select> contributes all of its option labels).
  function labelText(label) {
    const copy = label.cloneNode(true);
    copy.querySelectorAll('select,textarea,input,button').forEach(n => n.remove());
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function humanLabel(el) {
    const tag = el.localName;
    const text =
      el.getAttribute('aria-label') ||
      (el.labels && el.labels[0] && labelText(el.labels[0])) ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      (['input', 'textarea', 'select'].includes(tag) ? '' : visibleText(el)) ||
      el.getAttribute('title') ||
      el.id ||
      '';
    const kind = tag === 'input' ? `${el.type || 'text'} input` : tag;
    const t = text.length > 40 ? text.slice(0, 39) + '…' : text;
    return t ? `${kind} "${t}"` : kind;
  }

  function describeTarget(el) {
    const chain = hostChain(el);
    const selectors = localSelectors(el).map(s => [...chain, s].join(SHADOW_SEP));
    const text = visibleText(el);
    return {
      selectors,
      tag: el.localName,
      text: text && text.length <= 80 ? text : '',
      label: humanLabel(el)
    };
  }

  function querySelectorDeep(selector) {
    const parts = selector.split(SHADOW_SEP);
    let root = document;
    for (let i = 0; i < parts.length; i++) {
      let el;
      try {
        el = root.querySelector(parts[i]);
      } catch {
        return null;
      }
      if (!el) return null;
      if (i === parts.length - 1) return el;
      root = el.shadowRoot;
      if (!root) return null;
    }
    return null;
  }

  function findElement(target) {
    for (const sel of target.selectors || []) {
      const el = querySelectorDeep(sel);
      if (el) return el;
    }
    if (target.text) {
      const want = target.text;
      for (const el of document.querySelectorAll(target.tag || '*')) {
        if (visibleText(el) === want) return el;
      }
    }
    return null;
  }

  function isVisible(el) {
    if (!el.isConnected) return false;
    const r = el.getClientRects();
    if (!r.length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  const TEXT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number', '']);
  const CLICKABLE = 'a,button,input,select,textarea,label,summary,option,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=radio],[role=switch],[onclick],[tabindex]';

  function realTarget(e) {
    const t = e.composedPath()[0];
    return t && t.nodeType === 1 ? t : t?.parentElement || null;
  }

  function fromOverlay(e) {
    return overlayHost && e.composedPath().includes(overlayHost);
  }

  function isToggle(el) {
    return el.localName === 'input' && (el.type === 'checkbox' || el.type === 'radio');
  }

  function editableRoot(el) {
    let node = el;
    while (node.parentElement && node.parentElement.isContentEditable) node = node.parentElement;
    return node;
  }

  function send(step) {
    chrome.runtime
      .sendMessage({ type: 'am:recordStep', step: { ...step, frame: frameInfo() } })
      .catch(() => {});
  }

  function onClick(e) {
    if (!recording || !e.isTrusted || fromOverlay(e)) return;
    let el = realTarget(e);
    if (!el) return;
    // Checkbox / radio / select / file changes are recorded via 'change'
    // (idempotent "set state" steps instead of toggling clicks).
    if (isToggle(el) || el.localName === 'select' || el.localName === 'option') return;
    if (el.localName === 'input' && el.type === 'file') return;
    const label = el.closest('label');
    if (label && label.control && (isToggle(label.control) || label.control.type === 'file')) return;
    // Prefer the nearest interactive ancestor (e.g. the <button>, not the <svg> inside it).
    const clickable = el.closest(CLICKABLE);
    if (clickable) el = clickable;
    send({ action: 'click', target: describeTarget(el) });
  }

  function onInput(e) {
    if (!recording || !e.isTrusted || fromOverlay(e)) return;
    const el = realTarget(e);
    if (!el) return;
    if (el.localName === 'input' || el.localName === 'textarea') {
      if (isToggle(el) || el.type === 'file') return;
      const masked = el.type === 'password' && !recordPasswords;
      send({ action: 'type', target: describeTarget(el), value: masked ? '' : el.value, masked: el.type === 'password' });
    } else if (el.isContentEditable) {
      const root = editableRoot(el);
      send({ action: 'type', target: describeTarget(root), value: root.innerText, contentEditable: true });
    }
  }

  function onChange(e) {
    if (!recording || !e.isTrusted || fromOverlay(e)) return;
    const el = realTarget(e);
    if (!el) return;
    if (isToggle(el)) {
      send({ action: 'check', target: describeTarget(el), checked: el.checked });
    } else if (el.localName === 'select') {
      const selected = Array.from(el.selectedOptions);
      send({
        action: 'select',
        target: describeTarget(el),
        value: el.multiple ? selected.map(o => o.value) : el.value,
        text: selected.map(o => o.text.trim()).join(', ')
      });
    }
  }

  function onKeyDown(e) {
    if (!recording || !e.isTrusted || fromOverlay(e)) return;
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    const el = realTarget(e) || document.activeElement;
    if (!el) return;
    if (e.key === 'Enter' && (e.shiftKey || el.localName === 'textarea' || el.isContentEditable)) return;
    send({ action: 'key', key: e.key, target: describeTarget(el) });
  }

  function setRecording(on) {
    if (on === recording) return;
    recording = on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('click', onClick, true);
    window[method]('input', onInput, true);
    window[method]('change', onChange, true);
    window[method]('keydown', onKeyDown, true);
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function waitForElement(target, timeout, token, needVisible) {
    const deadline = Date.now() + timeout;
    let found = null;
    while (token === abortToken) {
      found = findElement(target);
      if (found && (!needVisible || isVisible(found))) return found;
      if (Date.now() > deadline) break;
      await sleep(100);
    }
    if (token !== abortToken) throw new Error('Aborted');
    if (found) return found; // exists but not visible — try anyway
    throw new Error(`Element not found: ${target.label || target.selectors?.[0] || 'unknown'}`);
  }

  function highlight(el) {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;border:2px solid #1a73e8;border-radius:4px;background:rgba(26,115,232,.12);box-shadow:0 0 0 4px rgba(26,115,232,.25);transition:opacity .4s;`;
    (document.body || document.documentElement).appendChild(box);
    setTimeout(() => (box.style.opacity = '0'), 500);
    setTimeout(() => box.remove(), 950);
  }

  function mouseOpts(el) {
    const r = el.getBoundingClientRect();
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2
    };
  }

  function focusable(el) {
    return el.closest('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable=true]');
  }

  function simulateClick(el) {
    const o = mouseOpts(el);
    el.dispatchEvent(new PointerEvent('pointerover', { ...o, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseover', o));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    focusable(el)?.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    // HTMLElement.click() runs default activation: follows links, submits
    // forms, toggles checkboxes, opens <details>, etc.
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', o));
  }

  function setNativeValue(el, value) {
    // Use the prototype setter so frameworks that wrap .value (React, etc.)
    // register the change.
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }

  const keyInit = (key, extra = {}) => {
    const codes = { Enter: 13, Escape: 27, Tab: 9 };
    const keyCode = codes[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const code = codes[key] ? key : /^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : /^\d$/.test(key) ? 'Digit' + key : '';
    return { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true, ...extra };
  };

  async function typeInto(el, value, step, settings, token) {
    value = String(value ?? '');
    const delay = Number(settings.typingDelay) || 0;
    el.focus({ preventScroll: true });

    if (step.contentEditable || (el.isContentEditable && !('value' in el))) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      if (delay <= 0) {
        document.execCommand('insertText', false, value);
      } else {
        document.execCommand('delete');
        for (const ch of value) {
          if (token !== abortToken) throw new Error('Aborted');
          document.execCommand('insertText', false, ch);
          await sleep(delay);
        }
      }
      return;
    }

    const charByChar = delay > 0 && (el.localName === 'textarea' || TEXT_TYPES.has(el.type));
    if (!charByChar) {
      setNativeValue(el, value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value }));
    } else {
      setNativeValue(el, '');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
      let current = '';
      for (const ch of value) {
        if (token !== abortToken) throw new Error('Aborted');
        el.dispatchEvent(new KeyboardEvent('keydown', keyInit(ch)));
        el.dispatchEvent(new KeyboardEvent('keypress', keyInit(ch, { charCode: ch.charCodeAt(0) })));
        current += ch;
        setNativeValue(el, current);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ch }));
        el.dispatchEvent(new KeyboardEvent('keyup', keyInit(ch)));
        await sleep(delay);
      }
      if (el.value !== value) setNativeValue(el, value); // e.g. number inputs reject partial values
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectOption(el, step) {
    const values = Array.isArray(step.value) ? step.value : [step.value];
    const options = Array.from(el.options);
    if (el.multiple) {
      for (const o of options) o.selected = values.includes(o.value);
    } else {
      let opt = options.find(o => o.value === values[0]);
      if (!opt && step.text) opt = options.find(o => o.text.trim() === step.text);
      if (!opt) throw new Error(`Option "${step.text || values[0]}" not found`);
      setNativeValue(el, opt.value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressKey(el, key) {
    const down = new KeyboardEvent('keydown', keyInit(key));
    const notPrevented = el.dispatchEvent(down);
    if (key === 'Enter') el.dispatchEvent(new KeyboardEvent('keypress', keyInit(key, { charCode: 13 })));
    el.dispatchEvent(new KeyboardEvent('keyup', keyInit(key)));
    // Synthetic keys don't trigger implicit form submission; do it explicitly.
    if (key === 'Enter' && notPrevented && el.localName === 'input' && el.form) {
      el.form.requestSubmit();
    }
  }

  async function exec(step, settings, timeout) {
    const token = abortToken;
    if (step.action === 'type' && step.masked && !step.value) {
      throw new Error('Password was not recorded — enter it for this step in the script manager');
    }
    const el = await waitForElement(step.target, timeout, token, step.action === 'click');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    if (settings.highlight) highlight(el);

    switch (step.action) {
      case 'click':
        simulateClick(el);
        break;
      case 'type':
        await typeInto(el, step.value, step, settings, token);
        break;
      case 'select':
        if (el.localName !== 'select') throw new Error('Target is not a <select>');
        selectOption(el, step);
        break;
      case 'check':
        if (el.checked !== step.checked) {
          simulateClick(el);
          if (el.checked !== step.checked) {
            el.checked = step.checked;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        break;
      case 'key':
        pressKey(el.isConnected ? el : document.activeElement || document.body, step.key);
        break;
      default:
        throw new Error(`Unsupported action "${step.action}"`);
    }
  }

  // -------------------------------------------------------------------------
  // Overlay (top frame only): REC indicator / playback progress with Stop.
  // -------------------------------------------------------------------------

  let overlayHost = null;
  let overlayParts = null;
  let resultTimer = null;

  function ensureOverlay() {
    if (overlayHost) return;
    overlayHost = document.createElement('action-mimic-overlay');
    const root = overlayHost.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .bar { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; align-items: center; gap: 10px;
          font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; background: #202124;
          padding: 8px 8px 8px 12px; border-radius: 999px; box-shadow: 0 4px 16px rgba(0,0,0,.3); user-select: none; }
        .dot { width: 10px; height: 10px; border-radius: 50%; background: #ea4335; animation: pulse 1.2s infinite; }
        .bar.play .dot { background: #34a853; animation: none; }
        .bar.ok .dot { background: #34a853; animation: none; }
        .bar.bad .dot { background: #fbbc04; animation: none; }
        @keyframes pulse { 50% { opacity: .3; } }
        button { all: unset; cursor: pointer; background: #3c4043; padding: 5px 12px; border-radius: 999px; font-weight: 600; }
        button:hover { background: #5f6368; }
        .bar.ok button, .bar.bad button { display: none; }
        .bar.ok, .bar.bad { padding-right: 14px; }
      </style>
      <div class="bar"><span class="dot"></span><span class="txt"></span><button type="button">Stop</button></div>`;
    overlayParts = { bar: root.querySelector('.bar'), txt: root.querySelector('.txt'), btn: root.querySelector('button') };
    overlayParts.btn.addEventListener('click', () => {
      const type = overlayParts.bar.classList.contains('play') ? 'am:stopPlayback' : 'am:stopRecording';
      chrome.runtime.sendMessage({ type }).catch(() => {});
    });
  }

  function showOverlay(cls, text) {
    ensureOverlay();
    overlayParts.bar.className = 'bar ' + cls;
    overlayParts.txt.textContent = text;
    if (!overlayHost.isConnected) document.documentElement.appendChild(overlayHost);
  }

  function hideOverlay() {
    overlayHost?.remove();
  }

  function renderOverlay(s) {
    if (!isTop) return;
    if (!s.showOverlay) return hideOverlay();
    if (s.recording) {
      clearTimeout(resultTimer);
      showOverlay('rec', `Recording · ${s.stepCount} step${s.stepCount === 1 ? '' : 's'}`);
    } else if (s.playing) {
      clearTimeout(resultTimer);
      showOverlay('play', `${s.playing.name} · ${s.playing.index}/${s.playing.total}`);
    } else if (s.result) {
      const r = s.result;
      const msg =
        r.status === 'done' ? `✓ ${r.name} completed`
        : r.status === 'stopped' ? `■ ${r.name} stopped`
        : r.status === 'partial' ? `⚠ ${r.name}: ${r.errors.length} step(s) failed`
        : `✗ ${r.name} failed at step ${r.completed}`;
      showOverlay(r.status === 'done' ? 'ok' : 'bad', msg);
      clearTimeout(resultTimer);
      resultTimer = setTimeout(hideOverlay, r.status === 'done' ? 2500 : 6000);
    } else {
      hideOverlay();
    }
  }

  function applyState(s) {
    if (!s) return;
    recordPasswords = !!s.recordPasswords;
    setRecording(!!s.recording);
    renderOverlay(s);
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'am:frameInfo':
        sendResponse(frameInfo());
        return false;
      case 'am:state':
        applyState(msg.state);
        return false;
      case 'am:abort':
        abortToken++;
        return false;
      case 'am:exec':
        exec(msg.step, msg.settings, msg.timeout).then(
          () => sendResponse({ ok: true }),
          e => sendResponse({ ok: false, error: e.message || String(e) })
        );
        return true;
      default:
        return false;
    }
  });

  chrome.runtime
    .sendMessage({ type: 'am:hello' })
    .then(applyState)
    .catch(() => {});
})();
