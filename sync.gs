/** @OnlyCurrentDoc */
// Weekly ↔ Google Sheet sync.
// Paste this into a blank Google Sheet: Extensions → Apps Script. Setup steps are in README.md.
//
// Two-way: the app sends its changes, and gets the whole sheet back in return, so every device
// shows the same data. Nothing works without the key.

const KEY = 'CHANGE-ME';  // replace with your own long random text, and enter the same text in the app

const PURCHASES = 'Purchases', BUDGET = 'Budget', INVEST = 'Investments';
const P_HEAD = ['id', 'date', 'name', 'category', 'amount', 'spread', 'added'];
const B_HEAD = ['type', 'name', 'amount', 'frequency', 'per month'];
// type is buy / sell / value. amount: buy = shares × price + fees (put in), sell = shares × price − fees
// (taken out), value = what all shares were worth that day.
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
        write(B, [['income', 'Monthly income', inc, 'monthly', inc], ['setting', 'Payday', payday, '', '']].concat((budget.bills || []).map(b => {
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
    const inv = read(I, I_HEAD.length).map(r => ({
      id: String(r[0]), date: day(r[1], tz), kind: String(r[2]),
      shares: Number(r[3]) || 0, price: Number(r[4]) || 0, fees: Number(r[5]) || 0,
      value: r[2] === 'value' ? Number(r[6]) || 0 : 0, t: String(r[7]),
    }));
    return out({ ok: true, purchases, hasBudget: bRows.length > 0, income: inc ? Number(inc[2]) || 0 : 0, payday: paydayOf(bRows), bills, inv });
  } finally {
    lock.releaseLock();
  }
}

// Totals only, for a widget: GET <url>?key=...
function doGet(e) {
  if (KEY === 'CHANGE-ME' || e.parameter.key !== KEY) return out({ ok: false, error: 'wrong key' });
  return out(summary());
}

// Same rules as the app: the period runs from payday to the day before the next payday, split into
// 4 weeks (the last one takes the extra days); (income - expenses per month) / 4 per week;
// a spread purchase is split evenly over its own week and the weeks after it.
function summary() {
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const bRows = read(sheet(ss, BUDGET, B_HEAD), B_HEAD.length), payday = paydayOf(bRows);

  // dates as UTC midnight, so day arithmetic is exact
  const [Y, M, D] = today.split('-').map(Number);
  const startIn = (y, mo) => new Date(Date.UTC(y, mo, Math.min(payday, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate())));
  let start = startIn(Y, M - 1);
  if (Date.UTC(Y, M - 1, D) < start) start = startIn(Y, M - 2);
  const next = startIn(start.getUTCFullYear(), start.getUTCMonth() + 1);
  const str = d => d.toISOString().slice(0, 10), from = str(start), to = str(new Date(next - 864e5));
  const weekOf = ds => Math.min(3, Math.floor((Date.parse(ds) - start) / 6048e5));

  let income = 0, fixed = 0;
  for (const [type, , amount, freq] of bRows) {
    if (type === 'income') income = Number(amount) || 0;
    else if (type === 'expense') fixed += perMonth(amount, freq);
  }
  const free = income - fixed, allow = [1, 2, 3, 4].map(() => free / 4), spent = [0, 0, 0, 0];
  let total = 0;
  for (const r of read(sheet(ss, PURCHASES, P_HEAD), P_HEAD.length)) {
    const ds = day(r[1], tz);
    if (ds < from || ds > to) continue;
    const k = weekOf(ds), amt = Number(r[4]) || 0;
    total += amt;
    if (r[5] === 'yes') for (let j = k; j < 4; j++) allow[j] -= amt / (4 - k);
    else spent[k] += amt;
  }
  const cur = weekOf(today), round = n => Math.round(n * 100) / 100;
  return { ok: true, date: today, week: cur + 1, weekLeft: round(allow[cur] - spent[cur]), weekAllowance: round(allow[cur]), monthLeft: round(free - total), nextPayday: str(next) };
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
