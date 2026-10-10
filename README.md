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
Every purchase you add or delete, and every change to income/expenses, is copied into a private
Google Sheet in your own account. Changes made offline are sent once you're back online.
It's write-only: the script never sends your purchases back out, only this week's totals (for a widget).

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
