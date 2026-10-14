# action-mimic

A QA testing Chrome extension that records the actions you take on a web page, saves them as a script scoped to a site, and replays them on demand. It's useful for states that are tedious to reach and easy to fat-finger, such as a long form inside an iframe on a page that's only reachable after logging in with the right permissions.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder (the one containing `manifest.json`).
3. Pin **Action Mimic** to the toolbar.

Requires Chrome 116 or newer. Nothing needs to be built.

## Using it

**Record**
1. Navigate to the page and get it into the state you want to start from.
2. Click the toolbar button, then **Record** (or press `Alt+Shift+R`). A red **REC** badge and an in-page pill show that recording is on.
3. Use the page normally. These are captured, in the top page and inside iframes, including cross-origin ones:
   - clicks
   - typing (only the final value of each field is kept)
   - `<select>` choices
   - checkboxes and radios
   - Enter and Escape
   - URLs you type into the address bar
4. Click **Stop** on the in-page pill or in the popup.
5. Name the script and choose where it's **available**: this host, a domain and its subdomains, this page, a URL prefix, a regex, or any site. The popup tells you whether the scope matches the page you recorded on.

**Replay**
1. Get the page into the same starting state.
2. Open the popup. It lists the scripts scoped to the current site; tick **Show all** to see the others.
3. Click **▶ Run**. Each element is highlighted as it's clicked or filled, and progress shows on the toolbar badge and the in-page pill. Press **Stop** at any time.

**Manage** (popup → *Manage scripts*)
- Edit any step's value, such as a name, email, select option or checkbox state, to change the test data without re-recording.
- Fix a step's selector, reorder or delete steps, or add **Wait** and **Go to URL** steps.
- Duplicate, delete, or export individual scripts.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Timing | Fixed delay | *Fixed* waits the same delay before every step. *As recorded* reproduces your original pauses. |
| Delay between steps | 400 ms | Used in fixed timing mode. |
| Speed multiplier / Longest pause | 1× / 5000 ms | Used in as-recorded timing mode. |
| Typing delay | 25 ms/char | How quickly fields fill in, so you can watch them. 0 fills instantly. |
| Element timeout | 10000 ms | How long to wait for an element, iframe or page load before a step fails. |
| When a step fails | Stop | Either stop the script or skip the step and continue. |
| Wait for page loads | On | Waits for the tab to finish loading before each step. |
| Highlight elements | On | Outlines each element as it's acted on. |
| Show in-page indicator | On | Shows the floating REC / progress pill. |
| Record password values | Off | When off, password steps are saved blank and you fill them in from the manager. |

## Storage and moving scripts

Everything is kept in `chrome.storage.local` on this machine and is never sent anywhere. To move scripts to another device, use **Import / Export**: export all scripts or a selection to a JSON file, then import that file on the other machine. On import, scripts that share an ID with an existing one come in as copies unless you choose to replace them.

> Exports contain the recorded values in plain text. That includes passwords if you turned on *Record password values*.

## How it works

```
manifest.json
src/background.js      service worker: recording/playback state, frame resolution, badge
src/content/content.js runs in every frame: selector generation, event capture, step execution, overlay
src/popup/             toolbar popup: record / stop / save / run
src/manager/           full-page script editor, settings, import/export
src/shared/            storage, scope matching, step descriptions, DOM helper
```

- **Element targeting.** Each step stores several selectors, most stable first: `data-testid` and similar test attributes, then `id`, `name`, `aria-label`/`placeholder`, then a CSS path. It also keeps the element's visible text as a fallback. Elements inside open shadow roots are addressed as `host >>> inner`.
- **Iframes.** Each step records which frame it happened in: the frame's index path from the top window and its URL. During playback the background finds the matching frame in the live tab and sends the step only to that frame.
- **Playback events.** Playback dispatches the full pointer/mouse/keyboard/input event sequence, sets values through the native setter (so React, Vue and other frameworks see the change), and uses `element.click()` so the default behavior happens: links navigate, forms submit, checkboxes toggle. Checkbox and select steps set the recorded state rather than toggling, so re-running a script is safe.

## Publishing

- **Build the upload zip:** run `python scripts/package.py`. It writes `dist/action-mimic-<version>.zip`.
- **Store submission:** [store/README.md](store/README.md) has the step-by-step checklist, the listing text, the privacy-practice answers, and the screenshots and promo tiles.
- **Privacy policy:** [PRIVACY.md](PRIVACY.md).

## Known limitations

- Played-back events are synthetic (`isTrusted === false`). A small number of sites ignore untrusted events.
- File uploads, drag and drop, hover-only menus, and native dialogs (`alert` and `confirm`) aren't recorded.
- Closed shadow roots and `chrome://` pages can't be accessed.
- Scripts always run in the current tab. Get to the starting state first, or add a **Go to URL** step at the beginning.
