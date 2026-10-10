/** @OnlyCurrentDoc */
// Weekly ↔ Google Sheet sync.
// Paste this into a blank Google Sheet: Extensions → Apps Script. Setup steps are in README.md.
//
// Two-way: the app sends its changes, and gets the whole sheet back in return, so every device
// shows the same data. Nothing works without the key.

const KEY = 'CHANGE-ME';  // replace with your own long random text, and enter the same text in the app

const PURCHASES = 'Purchases', BUDGET = 'Budget';
const P_HEAD = ['id', 'date', 'name', 'category', 'amount', 'spread', 'added'];
const B_HEAD = ['type', 'name', 'amount', 'frequency', 'per month'];
const PER_MONTH = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const perMonth = (amount, freq) => Math.round((Number(amount) || 0) * (PER_MONTH[freq] || 1) * 100) / 100;

// Receives a batch of changes from the app: { key, ops: [{type:'add', p}, {type:'del', id}, {type:'budget', income, bills}] }
// and answers with everything in the sheet: { ok, purchases, hasBudget, income, bills }.
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad request' }); }
  if (KEY === 'CHANGE-ME' || body.key !== KEY) return out({ ok: false, error: 'wrong key' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const P = sheet(ss, PURCHASES, P_HEAD), B = sheet(ss, BUDGET, B_HEAD);
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
      if (budget) {
        const inc = Number(budget.income) || 0;
        write(B, [['income', 'Monthly income', inc, 'monthly', inc]].concat((budget.bills || []).map(b => {
          const freq = PER_MONTH[b.freq] ? b.freq : 'monthly';
          return ['expense', text(b.name), Number(b.amount) || 0, freq, perMonth(b.amount, freq)];
        })), B_HEAD.length);
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
    return out({ ok: true, purchases, hasBudget: bRows.length > 0, income: inc ? Number(inc[2]) || 0 : 0, bills });
  } finally {
    lock.releaseLock();
  }
}

// Totals only, for a widget: GET <url>?key=...
function doGet(e) {
  if (KEY === 'CHANGE-ME' || e.parameter.key !== KEY) return out({ ok: false, error: 'wrong key' });
  return out(summary());
}

// Same rules as the app: (income - expenses per month) / 4 per week; weeks are days 1-7, 8-14, 15-21, 22-end;
// a spread purchase is split evenly over its own week and the weeks after it.
function summary() {
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), month = today.slice(0, 7);
  const weekOf = ds => Math.min(3, Math.floor((Number(ds.slice(8, 10)) - 1) / 7));

  let income = 0, fixed = 0;
  for (const [type, , amount, freq] of read(sheet(ss, BUDGET, B_HEAD), B_HEAD.length)) {
    if (type === 'income') income = Number(amount) || 0; else fixed += perMonth(amount, freq);
  }
  const free = income - fixed, allow = [1, 2, 3, 4].map(() => free / 4), spent = [0, 0, 0, 0];
  let total = 0;
  for (const r of read(sheet(ss, PURCHASES, P_HEAD), P_HEAD.length)) {
    const ds = day(r[1], tz);
    if (!ds.startsWith(month)) continue;
    const k = weekOf(ds), amt = Number(r[4]) || 0;
    total += amt;
    if (r[5] === 'yes') for (let j = k; j < 4; j++) allow[j] -= amt / (4 - k);
    else spent[k] += amt;
  }
  const cur = weekOf(today), round = n => Math.round(n * 100) / 100;
  return { ok: true, date: today, week: cur + 1, weekLeft: round(allow[cur] - spent[cur]), weekAllowance: round(allow[cur]), monthLeft: round(free - total) };
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
