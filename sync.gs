/** @OnlyCurrentDoc */
// Weekly ↔ Google Sheet sync.
// Paste this into a blank Google Sheet: Extensions → Apps Script. Setup steps are in README.md.
//
// Two-way: the app sends its changes, and gets the whole sheet back in return, so every device
// shows the same data. Nothing works without the key.
//
// Archive: after each pay period ends, a copy of just that period (purchases, investments and the
// budget) is saved as its own spreadsheet in a "Weekly archive" folder in your Drive. The main sheet
// is never changed by this. Needs the permissions in appsscript.json (see README.md).

const KEY = 'CHANGE-ME';  // replace with your own long random text, and enter the same text in the app

const PURCHASES = 'Purchases', BUDGET = 'Budget', INVEST = 'Investments';
const P_HEAD = ['id', 'date', 'name', 'category', 'amount', 'spread', 'added'];
const B_HEAD = ['type', 'name', 'amount', 'frequency', 'per month'];
// type is buy / sell (older rows may say value). amount: buy = shares × price + fees (put in),
// sell = shares × price − fees (taken out).
const I_HEAD = ['id', 'date', 'type', 'shares', 'price', 'fees', 'amount', 'added'];
const PER_MONTH = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const perMonth = (amount, freq) => Math.round((Number(amount) || 0) * (PER_MONTH[freq] || 1) * 100) / 100;

// Receives a batch of changes from the app:
//   { key, ops: [{type:'add', p}, {type:'del', id}, {type:'budget', income, payday, bills}, {type:'inv', e}, {type:'invdel', id}] }
// and answers with everything in the sheet: { ok, purchases, hasBudget, income, payday, bills, inv }.
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad request' }); }
  if (KEY === 'CHANGE-ME' || body.key !== KEY) return out({ ok: false, error: 'wrong key' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const P = sheet(ss, PURCHASES, P_HEAD), B = sheet(ss, BUDGET, B_HEAD), I = sheet(ss, INVEST, I_HEAD);
    const ops = body.ops || [];

    if (ops.length) {
      const rows = read(P, P_HEAD.length);
      const at = new Map(rows.map((r, i) => [String(r[0]), i]));
      const gone = new Set();
      let budget = null;
      for (const op of ops) {
        if (op.type === 'add' && op.p && op.p.id) {
          const p = op.p;
          const row = [p.id, p.date, text(p.note), text(p.cat), Number(p.amount) || 0, p.spread ? 'yes' : 'no', String(p.t || '')];
          if (at.has(p.id)) { rows[at.get(p.id)] = row; gone.delete(at.get(p.id)); }
          else { at.set(p.id, rows.length); rows.push(row); }
        } else if (op.type === 'del' && at.has(op.id)) {
          gone.add(at.get(op.id));
        } else if (op.type === 'budget') {
          budget = op;
        }
      }
      write(P, rows.filter((_, i) => !gone.has(i)), P_HEAD.length);
      upsert(I, I_HEAD.length, ops, 'inv', 'invdel', e => {
        const sh = Number(e.shares) || 0, pr = Number(e.price) || 0, fe = Number(e.fees) || 0;
        const amount = e.kind === 'buy' ? sh * pr + fe : e.kind === 'sell' ? sh * pr - fe : Number(e.value) || 0;
        return e.kind === 'value' ? [e.id, e.date, 'value', '', '', '', round2(amount), String(e.t || '')]
          : [e.id, e.date, e.kind, sh, pr, fe, round2(amount), String(e.t || '')];
      });
      if (budget) {
        const inc = Number(budget.income) || 0;
        const payday = Math.min(31, Math.max(1, Number(budget.payday) || 1));
        // carry rows: week start date → 1 if last week's minus was taken off that week, 0 if not
        const carry = Object.entries(budget.carry || {}).filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort()
          .map(([k, v]) => ['carry', k, v === 'yes' ? 1 : 0, '', '']);
        write(B, [['income', 'Monthly income', inc, 'monthly', inc], ['setting', 'Payday', payday, '', '']].concat((budget.bills || []).map(b => {
          const freq = PER_MONTH[b.freq] ? b.freq : 'monthly';
          return ['expense', text(b.name), Number(b.amount) || 0, freq, perMonth(b.amount, freq)];
        }), carry), B_HEAD.length);
      }
    }

    const tz = ss.getSpreadsheetTimeZone();
    const purchases = read(P, P_HEAD.length).map(r => ({
      id: String(r[0]), date: day(r[1], tz), note: String(r[2]), cat: String(r[3]),
      amount: Number(r[4]) || 0, spread: r[5] === 'yes', t: String(r[6]),
    }));
    const bRows = read(B, B_HEAD.length);
    const inc = bRows.find(r => r[0] === 'income');
    const bills = bRows.filter(r => r[0] === 'expense').map(r => ({ name: String(r[1]), amount: Number(r[2]) || 0, freq: PER_MONTH[r[3]] ? String(r[3]) : 'monthly' }));
    const inv = read(I, I_HEAD.length).map(r => ({
      id: String(r[0]), date: day(r[1], tz), kind: String(r[2]),
      shares: Number(r[3]) || 0, price: Number(r[4]) || 0, fees: Number(r[5]) || 0,
      value: r[2] === 'value' ? Number(r[6]) || 0 : 0, t: String(r[7]),
    }));
    archiveSafe(ss);
    return out({ ok: true, purchases, hasBudget: bRows.length > 0, income: inc ? Number(inc[2]) || 0 : 0, payday: paydayOf(bRows), carry: carryOf(bRows, tz), bills, inv });
  } finally {
    lock.releaseLock();
  }
}

// Totals only (this period), for the home-screen widget: GET <url>?key=...
function doGet(e) {
  if (KEY === 'CHANGE-ME' || e.parameter.key !== KEY) return out({ ok: false, error: 'wrong key' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    archiveSafe(SpreadsheetApp.getActive());
    return out(summary());
  } finally {
    lock.releaseLock();
  }
}

// Same rules as the app: the period runs from payday to the day before the next payday, split into
// 4 weeks (the last one takes the extra days); (income - expenses per month) / 4 per week;
// a spread purchase is split evenly over its own week and the weeks after it; and what was left
// (or overspent) in the previous week is added to a week if that was chosen in the app.
function summary() {
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const bRows = read(sheet(ss, BUDGET, B_HEAD), B_HEAD.length), payday = paydayOf(bRows);
  const { start, from, to, next } = periodOf(today, payday);

  let income = 0, fixed = 0;
  for (const [type, , amount, freq] of bRows) {
    if (type === 'income') income = Number(amount) || 0;
    else if (type === 'expense') fixed += perMonth(amount, freq);
  }
  const rows = read(sheet(ss, PURCHASES, P_HEAD), P_HEAD.length)
    .map(r => ({ date: day(r[1], tz), cat: String(r[3]), amount: Number(r[4]) || 0, spread: r[5] === 'yes' }));
  const ctx = { payday, free: income - fixed, carry: carryOf(bRows, tz), rows, first: rows.reduce((a, r) => !a || r.date < a ? r.date : a, '') };
  const weeks = periodWeeks(from, ctx, {});

  let total = 0;
  const cats = {};
  for (const r of rows) if (r.date >= from && r.date <= to) { total += r.amount; cats[r.cat] = (cats[r.cat] || 0) + r.amount; }
  const cur = Math.min(3, Math.floor((Date.parse(today) - start) / 6048e5)), round = n => Math.round(n * 100) / 100;
  return { ok: true, date: today, week: cur + 1, weekLeft: round(weeks[cur].left), weekAllowance: round(weeks[cur].allow),
    monthLeft: round(ctx.free - total + weeks[0].carried), nextPayday: next,
    from, to, spent: round(total), weeks: weeks.map(w => round(w.left)),
    categories: Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount: round(amount) })) };
}

// The 4 weeks of the period starting on `from`, same rules as the app. Week 1 can take over what
// was left in week 4 of the previous period, so this looks back as far as needed (memoised).
// Weeks that ended before the first purchase ever don't carry anything.
function periodWeeks(from, ctx, memo) {
  if (memo[from]) return memo[from];
  const p = periodOf(from, ctx.payday), d = n => new Date(p.start.getTime() + n * 864e5).toISOString().slice(0, 10);
  const weeks = [0, 1, 2, 3].map(k => ({ start: d(k * 7), end: k === 3 ? p.to : d(k * 7 + 6), allow: ctx.free / 4, spent: 0 }));
  for (const r of ctx.rows) {
    if (r.date < p.from || r.date > p.to) continue;
    const k = Math.min(3, Math.floor((Date.parse(r.date) - p.start) / 6048e5));
    if (r.spread) for (let j = k; j < 4; j++) weeks[j].allow -= r.amount / (4 - k);
    else weeks[k].spent += r.amount;
  }
  weeks.forEach((w, k) => {
    let prev = weeks[k - 1];
    if (!k && ctx.first && d(-1) >= ctx.first) prev = periodWeeks(periodOf(d(-1), ctx.payday).from, ctx, memo)[3];
    const eligible = prev && ctx.first && prev.end >= ctx.first;
    w.carried = eligible && ctx.carry[w.start] === 'yes' ? prev.left : 0;
    w.allow += w.carried;
    w.left = w.allow - w.spent;
  });
  return memo[from] = weeks;
}

// Applies add/delete ops (matched by id) to a sheet whose first column is the id.
function upsert(s, cols, ops, addType, delType, toRow) {
  const rows = read(s, cols);
  const at = new Map(rows.map((r, i) => [String(r[0]), i]));
  const gone = new Set();
  let changed = false;
  for (const op of ops) {
    if (op.type === addType && op.e && op.e.id) {
      const row = toRow(op.e);
      if (at.has(op.e.id)) { rows[at.get(op.e.id)] = row; gone.delete(at.get(op.e.id)); }
      else { at.set(op.e.id, rows.length); rows.push(row); }
      changed = true;
    } else if (op.type === delType && at.has(op.id)) {
      gone.add(at.get(op.id)); changed = true;
    }
  }
  if (changed) write(s, rows.filter((_, i) => !gone.has(i)), cols);
}
function round2(n) { return Math.round(n * 100) / 100; }

// The pay period that contains the day ds ('yyyy-MM-dd'): from payday to the day before the next one.
// Dates are handled as UTC midnight so day arithmetic is exact. start is a Date, the rest are strings.
function periodOf(ds, payday) {
  const [Y, M, D] = ds.split('-').map(Number);
  const startIn = (y, mo) => new Date(Date.UTC(y, mo, Math.min(payday, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate())));
  let start = startIn(Y, M - 1);
  if (Date.UTC(Y, M - 1, D) < start) start = startIn(Y, M - 2);
  const next = startIn(start.getUTCFullYear(), start.getUTCMonth() + 1);
  const str = d => d.toISOString().slice(0, 10);
  return { start, from: str(start), to: str(new Date(next - 864e5)), next: str(next) };
}

// ---------- archive ----------
// Saves every finished period with data that hasn't been saved yet. It remembers the last day it
// saved, so nothing is saved twice, even if the payday changes (the first period after a change
// then only covers the days not saved yet). Runs on each sync (cheap when there's nothing to do).
// A failure never breaks syncing; it's retried on the next sync.
function archiveSafe(ss) {
  try { archive(ss); } catch (err) { console.error('archive failed: ' + err); }
}
function archive(ss) {
  const props = PropertiesService.getScriptProperties();
  const d = sheetData(ss);
  const current = periodOf(d.today, d.payday).from;
  let through = props.getProperty('archivedThrough') || '';  // last day already saved ('' = none yet)
  const todo = new Set();
  for (const r of d.pRows.concat(d.iRows)) {
    if (r[1] > through && r[1] < current) todo.add(periodOf(r[1], d.payday).from);
  }
  for (const from of [...todo].sort()) {
    const p = periodOf(from, d.payday);
    const start = through >= p.from ? nextDay(through) : p.from;
    savePeriod(d, { from: start, to: p.to }, `Weekly ${start} – ${p.to}`);
    through = p.to;
    props.setProperty('archivedThrough', through);
  }
}
function nextDay(ds) { return new Date(Date.parse(ds) + 864e5).toISOString().slice(0, 10); }
// Run this once from the Apps Script editor (pick testArchive next to "Debug", then Run) to grant the
// Drive permission and check that archiving works. It saves the current period as a TEST copy in the
// "Weekly archive" folder; you can delete that copy afterwards.
function testArchive() {
  const d = sheetData(SpreadsheetApp.getActive()), p = periodOf(d.today, d.payday);
  savePeriod(d, p, `Weekly TEST ${p.from} – ${p.to} (safe to delete)`);
}
function sheetData(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const bRows = read(sheet(ss, BUDGET, B_HEAD), B_HEAD.length);
  return {
    today: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), payday: paydayOf(bRows), bRows,
    pRows: read(sheet(ss, PURCHASES, P_HEAD), P_HEAD.length).map(r => (r[1] = day(r[1], tz), r)),
    iRows: read(sheet(ss, INVEST, I_HEAD), I_HEAD.length).map(r => (r[1] = day(r[1], tz), r)),
  };
}
function savePeriod(d, p, title) {
  const inP = r => r[1] >= p.from && r[1] <= p.to;
  saveCopy(title, [
    [PURCHASES, [P_HEAD].concat(d.pRows.filter(inP))],
    [INVEST, [I_HEAD].concat(d.iRows.filter(inP))],
    [BUDGET, [B_HEAD].concat(d.bRows)],
  ]);
}
// Creates a spreadsheet in the archive folder with one tab per [name, rows]. Uses the Drive and
// Sheets APIs directly, so the script only needs access to files it created itself.
function saveCopy(title, tabs) {
  const file = api('post', 'https://www.googleapis.com/drive/v3/files',
    { name: title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [archiveFolder()] });
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + file.id;
  const first = api('get', base + '?fields=sheets.properties.sheetId').sheets[0].properties.sheetId;
  api('post', base + ':batchUpdate', { requests: tabs.map(([name], i) => i === 0
    ? { updateSheetProperties: { properties: { sheetId: first, title: name, gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } }
    : { addSheet: { properties: { title: name, gridProperties: { frozenRowCount: 1 } } } }) });
  api('post', base + '/values:batchUpdate', {
    valueInputOption: 'USER_ENTERED',
    data: tabs.map(([name, rows]) => ({ range: `'${name}'!A1`, values: rows.map(r => r.map(v => typeof v === 'string' ? text(v) : v)) })),
  });
}
function archiveFolder() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('archiveFolder');
  if (id) {
    try { if (!api('get', `https://www.googleapis.com/drive/v3/files/${id}?fields=trashed`).trashed) return id; } catch (err) {}
  }
  id = api('post', 'https://www.googleapis.com/drive/v3/files', { name: 'Weekly archive', mimeType: 'application/vnd.google-apps.folder' }).id;
  props.setProperty('archiveFolder', id);
  return id;
}
function api(method, url, body) {
  const res = UrlFetchApp.fetch(url, {
    method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined,
  });
  if (res.getResponseCode() >= 300) throw new Error(`${method} ${url} → ${res.getResponseCode()}: ${res.getContentText().slice(0, 300)}`);
  return JSON.parse(res.getContentText() || '{}');
}

function carryOf(bRows, tz) {
  const c = {};
  for (const r of bRows) if (r[0] === 'carry') c[day(r[1], tz)] = Number(r[2]) ? 'yes' : 'no';
  return c;
}

function paydayOf(bRows) {
  const r = bRows.find(r => r[0] === 'setting' && r[1] === 'Payday');
  return r ? Math.min(31, Math.max(1, Number(r[2]) || 1)) : 1;
}

function sheet(ss, name, head) {
  let s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); s.setFrozenRows(1); }
  s.getRange(1, 1, 1, head.length).setValues([head]);
  return s;
}
function read(s, cols) {
  return s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, cols).getValues() : [];
}
function write(s, rows, cols) {
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, cols).clearContent();
  if (rows.length) s.getRange(2, 1, rows.length, cols).setValues(rows);
}
// Sheets turns "2026-10-10" into a date; turn it back into text.
function day(v, tz) {
  return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v);
}
// Stop names like "=SUM(...)" being treated as formulas.
function text(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
