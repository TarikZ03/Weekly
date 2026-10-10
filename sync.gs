// Weekly → Google Sheet sync.
// Paste this into a blank Google Sheet: Extensions → Apps Script. Setup steps are in README.md.
//
// Write-only on purpose: the app can add/delete purchases and update the budget, but nothing
// here ever sends your purchases back out. The only thing it returns is this week's totals
// (for a widget), and only with the right key.

const KEY = 'CHANGE-ME';  // replace with your own long random text, and enter the same text in the app

const PURCHASES = 'Purchases', BUDGET = 'Budget';
const P_HEAD = ['id', 'date', 'name', 'category', 'amount', 'spread'];
const B_HEAD = ['type', 'name', 'amount'];

// Receives a batch of changes from the app: { key, ops: [{type:'add', p}, {type:'del', id}, {type:'budget', income, bills}] }
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad request' }); }
  if (KEY === 'CHANGE-ME' || body.key !== KEY) return out({ ok: false, error: 'wrong key' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const P = sheet(ss, PURCHASES, P_HEAD);
    const rows = read(P, P_HEAD.length);
    const at = new Map(rows.map((r, i) => [String(r[0]), i]));
    const gone = new Set();
    let budget = null;

    for (const op of body.ops || []) {
      if (op.type === 'add' && op.p && op.p.id) {
        const p = op.p;
        const row = [p.id, p.date, text(p.note), text(p.cat), Number(p.amount) || 0, p.spread ? 'yes' : 'no'];
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
      const B = sheet(ss, BUDGET, B_HEAD);
      const bRows = [['income', 'Monthly income', Number(budget.income) || 0]]
        .concat((budget.bills || []).map(b => ['expense', text(b.name), Number(b.amount) || 0]));
      write(B, bRows, B_HEAD.length);
    }
    return out({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Totals only, for a widget: GET <url>?key=...
function doGet(e) {
  if (KEY === 'CHANGE-ME' || e.parameter.key !== KEY) return out({ ok: false, error: 'wrong key' });
  return out(summary());
}

// Same rules as the app: (income - expenses) / 4 per week; weeks are days 1-7, 8-14, 15-21, 22-end;
// a spread purchase is split evenly over its own week and the weeks after it.
function summary() {
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), month = today.slice(0, 7);
  const weekOf = ds => Math.min(3, Math.floor((Number(ds.slice(8, 10)) - 1) / 7));

  let income = 0, fixed = 0;
  for (const [type, , amount] of read(sheet(ss, BUDGET, B_HEAD), B_HEAD.length)) {
    if (type === 'income') income = Number(amount) || 0; else fixed += Number(amount) || 0;
  }
  const free = income - fixed, allow = [1, 2, 3, 4].map(() => free / 4), spent = [0, 0, 0, 0];
  let total = 0;
  for (const r of read(sheet(ss, PURCHASES, P_HEAD), P_HEAD.length)) {
    const ds = r[1] instanceof Date ? Utilities.formatDate(r[1], tz, 'yyyy-MM-dd') : String(r[1]);
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
  if (!s) { s = ss.insertSheet(name); s.appendRow(head); s.setFrozenRows(1); }
  return s;
}
function read(s, cols) {
  return s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, cols).getValues() : [];
}
function write(s, rows, cols) {
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, cols).clearContent();
  if (rows.length) s.getRange(2, 1, rows.length, cols).setValues(rows);
}
// Stop names like "=SUM(...)" being treated as formulas.
function text(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
