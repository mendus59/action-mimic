# Store listing tab

Copy each field into the matching box in the Chrome Web Store Developer Dashboard (**Store listing** tab).

## Product details

**Title** (comes from `manifest.json`)
```
Action Mimic
```

**Summary** (comes from the manifest `description`, max 132 chars)
```
Record, save, and replay repeatable front-end QA actions, scoped to the sites they belong to.
```

**Description**
```
Action Mimic records the steps you take on a web page and replays them in one click. It's built for QA testers and developers who keep re-entering the same data to reach a hard-to-reproduce state, such as a long form that's only reachable after logging in with the right permissions, or a form embedded in an iframe from another service.

HOW IT WORKS
1. Get the page into the state you want to start from.
2. Click Record, then use the page normally.
3. Click Stop, name the script, and choose which sites it's available on.
4. Next time, open Action Mimic on that site and click Run. Every click, keystroke and selection is replayed for you to watch, with each element highlighted as it's acted on.

WHAT IT RECORDS
• Clicks on buttons, links and any other element. The page's own JavaScript and HTML behavior runs as usual.
• Typing in inputs, text areas and rich-text editors.
• Dropdown choices, checkboxes and radio buttons.
• Enter and Escape key presses.
• URLs you type into the address bar.
• All of the above inside iframes, including cross-origin iframes, and in open shadow DOM.

SCOPED TO THE RIGHT SITE
Make a script available on one exact host, a whole domain and its subdomains, a single page, a URL prefix, a regular expression, or every site. The popup shows only the scripts that apply to the page you're on.

CHANGE THE TEST DATA WITHOUT RE-RECORDING
The script editor lets you change any value a step enters, adjust how a step finds its element, reorder or delete steps, and add waits or "go to URL" steps.

PLAYBACK SETTINGS
• Fixed delay between steps, or replay with your original timing (with a speed multiplier).
• Typing speed: watch fields fill character by character, or fill them instantly.
• Element timeout: how long to wait for elements, iframes and page loads.
• Stop on the first failed step, or skip it and continue.
• Element highlighting and an in-page progress indicator with a Stop button.

PRIVATE BY DESIGN
• Everything is stored locally in your browser. There are no accounts, servers, analytics or tracking.
• Password fields are not recorded unless you turn that on.
• Export scripts to a JSON file and import them on another computer or share them with your team.

KEYBOARD SHORTCUT
Alt+Shift+R starts or stops recording. You can change it at chrome://extensions/shortcuts.

LIMITATIONS
Replayed events are simulated by the browser, and a few sites deliberately ignore simulated input. File uploads, drag and drop, and native alert/confirm dialogs aren't recorded.
```

**Category**
```
Developer Tools
```

**Language**
```
English (United States)
```

## Graphic assets

| Field | File | Required |
|---|---|---|
| Store icon (128×128) | `store/promo/store-icon-128.png` | Yes |
| Screenshots (1280×800, up to 5) | `store/screenshots/1-record.png` … `5-edit.png`, uploaded in order | At least 1 |
| Small promo tile (440×280) | `store/promo/small-promo-440x280.png` | Recommended |
| Marquee promo tile (1400×560) | `store/promo/marquee-promo-1400x560.png` | Optional (used only if Google features the extension) |

The screenshots show a fictional "Demo Portal" app that is served locally by `store/tools/demo-site.mjs`. To regenerate them after UI changes, run `cd store/tools && npm install && npm run assets`.

## Additional fields

| Field | Value |
|---|---|
| Official URL | Leave as *None* unless you verify a domain in Search Console |
| Homepage URL | `https://github.com/mendus59/action-mimic` |
| Support URL | `https://github.com/mendus59/action-mimic/issues` |
| Mature content | No |
