# Privacy practices tab

Answers for the **Privacy practices** tab of the Chrome Web Store Developer Dashboard. Reviewers read the permission justifications closely, especially the one for access to all websites, so paste them as written.

## Single purpose description
```
Action Mimic records the interactions a user performs on a web page (clicks, typing, dropdown and checkbox choices) when the user explicitly starts a recording, saves them locally as a script scoped to a site, and replays that script on demand to automate repeatable QA and testing steps.
```

## Permission justifications

**storage**
```
Saves the user's recorded scripts and extension settings in chrome.storage.local, and keeps the state of an in-progress recording in chrome.storage.session so it survives the service worker being suspended. No data is sent off the device.
```

**scripting**
```
Injects the extension's own bundled content script (src/content/content.js) into tabs that were already open when the extension was installed or updated, so the user can record or replay there without reloading the page. Only packaged files are injected; no remote or dynamically generated code is executed.
```

**webNavigation**
```
During playback, webNavigation.getAllFrames is used to find the iframe that a recorded step belongs to (for example, a form embedded from another domain), so the step can be sent to that frame only. During recording, webNavigation.onCommitted detects navigations the user makes from the address bar, such as typed URLs, reloads and back/forward, so they can be saved as "go to URL" steps.
```

**Host permission (`<all_urls>`), and content scripts on all URLs in all frames**
```
Action Mimic is a general-purpose QA tool. Users record and replay tests on whatever sites they are testing, including internal, staging and localhost environments whose addresses cannot be known in advance. Those flows commonly include iframes served from other origins (for example, an embedded payment or vendor form). To capture a user's clicks and input, and later replay them inside those frames, the content script must be able to run in every frame on any site. The content script is passive until the user presses Record or Run. It only reports events from the single tab being recorded, while a visible REC indicator is shown. All recorded data stays in local extension storage.
```

## Remote code
```
No, I am not using remote code.
```
All JavaScript is bundled in the package. The extension does not use `eval`, `new Function`, or remotely hosted scripts.

## Data usage

**What user data do you plan to collect from users now or in the future?**

Recommended: **leave every category unchecked.** The Web Store treats data as "collected" when it is transmitted off the user's device. Action Mimic never transmits anything: it has no servers and makes no network requests, and the only way data leaves the browser is an export file that the user saves themselves. This matches the privacy policy, which says the extension does not collect data.

> If a reviewer disagrees and asks you to disclose what the extension *handles* locally, check **User activity** (clicks and keystrokes captured during recording) and **Website content** (form values and page URLs saved in scripts). Also add **Authentication information** if you want to account for the optional *Record password values* setting. Changing the disclosure doesn't require a code change.

**Certifications.** Check all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**
```
https://github.com/mendus59/action-mimic/blob/main/PRIVACY.md
```
This URL only works once `PRIVACY.md` is pushed to `main` and the repository is **public**. See the [submission checklist](README.md).
