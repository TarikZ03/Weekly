# Weekly

A personal weekly budget app for iPhone. Your monthly income minus bills is the money for
groceries + fun, shown as a weekly Safe-to-Spend. Big purchases can be spread over the rest
of the month instead of emptying one week.

All data stays on the phone (browser storage). Everything is on one screen; tap "Edit" at the
bottom to set your income and recurring expenses.

## Put it on your iPhone (GitHub Pages, free)
1. Create a new public repository on github.com, e.g. `weekly`.
2. Upload these files to it: `index.html`, `manifest.webmanifest`, `sw.js`, `icon-180.png`,
   `icon-192.png`, `icon-512.png` ("Add file" → "Upload files").
3. Repository Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
4. After a minute the app is at `https://<your-username>.github.io/weekly/`.
5. Open that link in **Safari** on the iPhone → Share button → **Add to Home Screen**.

Open it from the home-screen icon from then on: it runs full screen and works offline.

## Updating
Upload the changed files again. The app picks up the new version the second time you open it.
If you change `sw.js`'s file list, bump `CACHE` in `sw.js`.

## Google Sheet sync (optional)
Every purchase you add or delete, and every change to income/expenses, is saved in a private
Google Sheet in your own account, and every device connected to it shows the same data. Changes made
offline are sent once you're back online. Anyone with both the URL and the key can read the data,
so keep those two private.

1. Go to https://sheets.new and give the sheet a name.
2. Extensions → Apps Script. Delete what's there, paste in all of `sync.gs`.
3. Replace `CHANGE-ME` with a long random key, e.g. the output of
   `python3 -c "import secrets; print(secrets.token_urlsafe(24))"`. Click Save.
4. Deploy → New deployment → gear icon → **Web app**.
   Execute as: **Me**. Who has access: **Anyone** (the key is what protects it). Click Deploy.
5. Allow access when asked. Google will say the app isn't verified, since it's your own script:
   Advanced → Go to (project name) → Allow.
6. Copy the **Web app URL** (ends in `/exec`).
7. In the app: Edit (bottom) → paste the URL and the key → **Connect**. It should say "Synced ✓",
   and the sheet gets `Purchases` and `Budget` tabs.

Keep the URL and key private. To cut off access: Deploy → Manage deployments → Archive, then make a
new deployment (new URL) and reconnect. If you edit the script: Manage deployments → Edit → Version: New.
Download the data as CSV any time from the sheet: File → Download → CSV.

## Home-screen widget (optional, needs the sheet sync)
1. Install **Scriptable** (free) from the App Store.
2. In the Weekly app: Edit → **Copy widget script** (it fills in your URL and key).
3. In Scriptable: tap **+**, paste, tap the title at the top to name it `Weekly`, then **Done**.
   Tap the script once to preview it.
4. Long-press the home screen → **Edit** → **Add Widget** → Scriptable → choose the **Large** size → Add Widget.
5. Long-press the new widget → **Edit Widget** → Script: **Weekly**.

It shows this pay period's totals and refreshes about every 15 minutes (iOS decides exactly when).
The copied script contains your URL and key, so don't share it. `widget.js` in this repo has placeholders only.

## Archive (one copy per pay period)
After each pay period ends, the next sync saves a copy of just that period (its purchases, its
investments, and the budget at that moment) as its own spreadsheet, e.g. `Weekly 2026-09-23 – 2026-10-22`,
in a **Weekly archive** folder in your Google Drive. The main sheet keeps everything and is never
changed by this. Each period is saved once.

It needs one extra permission: access to files the script creates itself (nothing else in your Drive).
1. In Apps Script: Project Settings (gear) → tick **Show "appsscript.json" manifest file in editor**.
2. Back in the Editor, open `appsscript.json` and replace it with the one in this repo. Save.
3. Next to **Services** click **+** and add **Drive API**, then again and add **Google Sheets API**
   (this switches those APIs on for the script; the code calls them directly).
4. Pick `testArchive` in the function dropdown next to "Debug" → **Run** → allow access.
   A `Weekly TEST …` copy appears in the Weekly archive folder (delete it afterwards).
5. Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
