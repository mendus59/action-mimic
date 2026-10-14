# Action Mimic Privacy Policy

_Last updated: October 14, 2026_

Action Mimic is a Chrome extension that records the actions you take on a web page and replays them later. This policy explains what data the extension handles and what happens to it.

## Summary

- Action Mimic **does not collect, transmit, sell, or share any data**.
- Everything the extension records stays in your browser's local extension storage (`chrome.storage.local`) on your own device.
- The extension contains no analytics, no tracking, no advertising, and no remote servers. It makes no network requests of its own.

## What the extension handles, and why

When **you** start a recording, Action Mimic captures the actions you take on the page so it can replay them later:

| Data | Purpose | Where it goes |
|---|---|---|
| Elements you click, and how to find them again (CSS selectors, element labels and visible text) | To click the same elements during replay | Stored locally on your device |
| Values you type or choose in form fields, checkboxes and dropdowns | To enter the same values during replay | Stored locally on your device |
| URLs of the pages and frames where actions happened | To scope scripts to sites and to replay steps in the right frame | Stored locally on your device |
| Your extension settings (speed, timeouts, etc.) | To control playback | Stored locally on your device |

Recording happens only between when you press **Record** and when you press **Stop**. It is limited to the browser tab you started it in, and a visible "REC" badge and in-page indicator are shown the whole time. Nothing is captured while the extension is idle.

**Passwords.** By default, the values of password fields are **not** recorded. If you turn on the *Record password values* setting, they are stored in plain text in local extension storage and included in any export you make.

## Exports

You can choose to export scripts to a JSON file, for example to move them to another computer. Export is always started by you, the file is saved to your device through your browser's normal download process, and it is never sent anywhere by the extension. Anything you then do with that file, such as emailing it, is under your control and outside the extension.

## Data retention and deletion

Data stays until you delete it. You can delete individual scripts or all of them on the extension's **Manage scripts** page. Uninstalling the extension removes all of its stored data from your browser.

## Permissions

- **Access to all websites.** QA work happens on arbitrary sites, including internal, staging and `localhost` environments, and often inside iframes from other domains. The extension needs this access to record and replay actions wherever you choose to use it. It does nothing on a page unless you are recording or have started a replay there.
- **storage.** Saves your scripts and settings locally.
- **scripting.** Loads the recorder/player into tabs that were already open when the extension was installed or updated.
- **webNavigation.** Finds the correct iframe for each replayed step and notices URLs you type into the address bar while recording.

## Children's privacy

Action Mimic is a developer and QA tool. It is not directed at children and collects no data from anyone.

## Changes

If this policy changes, the updated version will be published at this same address with a new "Last updated" date.

## Contact

Questions about this policy: **patmendus@patmendus.com**
