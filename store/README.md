# Publishing to the Chrome Web Store

Everything needed to submit Action Mimic is in this folder:

| File | What it's for |
|---|---|
| [listing.md](listing.md) | Text for the **Store listing** tab: title, summary, description, category |
| [privacy-practices.md](privacy-practices.md) | Answers for the **Privacy practices** tab: single purpose, permission justifications, data disclosures |
| [../PRIVACY.md](../PRIVACY.md) | Privacy policy. The store needs a public URL for it. |
| `screenshots/` | Five 1280×800 screenshots |
| `promo/` | 128×128 store icon, 440×280 small promo tile, 1400×560 marquee tile |
| [../scripts/package.py](../scripts/package.py) | Builds the upload zip |
| `tools/` | Regenerates the screenshots and promo tiles from the real extension |

## 1. One-time account setup

1. Sign in to Google as **patmendus@patmendus.com**. Two-step verification must be turned on for the account.
2. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Accept the developer agreement and pay the one-time **US$5** registration fee.
3. In **Account**:
   - Set the publisher display name, for example *Action Mimic*.
   - Set the **contact email** to `patmendus@patmendus.com` and verify it using the link Google emails you. You can't publish until it's verified.
   - Complete the **trader / non-trader** declaration that EU law requires. For a personal or independent-study project you are most likely a *non-trader*. If you are distributing on behalf of a business, choose *trader*. Your business contact details are then shown publicly.

## 2. Publish the privacy policy

The privacy policy URL must be publicly reachable before you submit.

```sh
git add -A
git commit -m "Prepare Chrome Web Store release"
git push origin main
```

Then make sure **github.com/mendus59/action-mimic** is a **public** repository. Open
<https://github.com/mendus59/action-mimic/blob/main/PRIVACY.md> in a private window to confirm it loads.

## 3. Build the package

From the repository root:

```sh
python scripts/package.py
```

This checks the manifest against store limits, verifies that every referenced file exists, and writes `dist/action-mimic-<version>.zip`. The zip contains only `manifest.json`, `icons/` and `src/`.

**Smoke-test the exact zip before uploading.** Unzip it into a new folder, load that folder with **Load unpacked** at `chrome://extensions`, then record and replay a short script.

## 4. Create the item

1. In the dashboard, click **New item** and upload `dist/action-mimic-1.0.0.zip`.
2. **Store listing:** paste the fields from [listing.md](listing.md) and upload the images from `screenshots/` and `promo/`.
3. **Privacy practices:** paste the answers from [privacy-practices.md](privacy-practices.md) and tick the three certifications.
4. **Distribution:**
   - **Visibility:** *Public*, or *Unlisted* if only people with the link should be able to install it. Unlisted suits sharing within a team or class.
   - **Regions:** all regions, unless you have a reason to limit them.
   - **Payment:** free.
5. Click **Submit for review**. You can tick *Publish automatically after review* or publish manually once it's approved.

### Review expectations

Because the extension requests access to all websites, expect an **in-depth review**. That usually takes a few days and can occasionally take a couple of weeks. The justifications in [privacy-practices.md](privacy-practices.md) are written for that review. If you're rejected, the email names the policy involved. The most common causes are a missing permission justification, a privacy policy that doesn't match the data disclosure, or a broken privacy policy URL.

## 5. Shipping updates

1. Bump `"version"` in `manifest.json`. The store rejects a zip whose version isn't higher than the published one.
2. If the UI changed, regenerate the images:
   ```sh
   cd store/tools && npm install && npm run assets
   ```
   This launches Chrome for Testing with the unpacked extension and a local demo site, drives a real record-and-replay session, and writes new files to `screenshots/` and `promo/`.
3. Run `python scripts/package.py`, then in the dashboard open **Package → Upload new package** and **Submit for review**.

If an update adds a permission, Chrome disables the extension for existing users until they approve the new permission. Avoid adding permissions casually.
