// Weekly — home-screen widget for the Scriptable app (https://scriptable.app).
// Easiest: in the Weekly app tap Edit → "Copy widget script" (fills in your URL and key), then paste
// into a new Scriptable script. Made for the Large (4×4) widget; Small and Medium show less.
// Shows only totals for this pay period; refreshes about every 15 minutes (iOS decides exactly when).

const API_URL = '__URL__';
const KEY = '__KEY__';

const C = {
  bg: Color.dynamic(new Color('#F7F8FA'), new Color('#111214')),
  card: Color.dynamic(new Color('#FFFFFF'), new Color('#1B1D21')),
  line: Color.dynamic(new Color('#E4E7EB'), new Color('#2A2D33')),
  text: Color.dynamic(new Color('#2B2E34'), new Color('#ECEDEF')),
  muted: Color.dynamic(new Color('#8A8F98'), new Color('#8E939C')),
  green: Color.dynamic(new Color('#22A06B'), new Color('#4CC38A')),
  red: Color.dynamic(new Color('#D9365E'), new Color('#F0698A')),
};
const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const money = n => eur.format(Math.abs(n) < .005 ? 0 : n);
const money0 = n => eur0.format(Math.abs(n) < .5 ? 0 : n);
const md = s => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const pad = n => String(n).padStart(2, '0');
const plusDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Last good result is kept on the phone, so the widget still shows something when offline.
const fm = FileManager.local(), cache = fm.joinPath(fm.documentsDirectory(), 'weekly-widget.json');
async function load() {
  try {
    const j = await new Request(`${API_URL}?key=${encodeURIComponent(KEY)}`).loadJSON();
    if (j.ok) { fm.writeString(cache, JSON.stringify(j)); return { j, stale: false }; }
    return { error: j.error === 'wrong key' ? 'Wrong key' : 'Sheet error' };
  } catch (e) {
    if (fm.fileExists(cache)) return { j: JSON.parse(fm.readString(cache)), stale: true };
    return { error: "Couldn't reach the sheet" };
  }
}

function text(stack, str, font, color, opts = {}) {
  const t = stack.addText(str);
  t.font = font; t.textColor = color; t.lineLimit = 1;
  t.minimumScaleFactor = opts.scale || 0.6;
  return t;
}
function row(parent) { const s = parent.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; }

async function build() {
  const family = config.widgetFamily || 'large';
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(16, 16, 16, 16);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const { j, stale, error } = await load();
  if (error) {
    text(w, 'Weekly', Font.semiboldSystemFont(15), C.muted);
    w.addSpacer(6);
    text(w, error, Font.mediumSystemFont(15), C.red);
    return w;
  }
  const left = j.weekLeft, neg = left < -0.004;

  // small: just this week
  if (family === 'small') {
    text(w, `Week ${j.week} of 4`, Font.mediumSystemFont(12), C.muted);
    w.addSpacer();
    text(w, money(left), Font.boldSystemFont(30), neg ? C.red : C.green, { scale: 0.4 });
    text(w, 'left this week', Font.systemFont(12), C.muted);
    w.addSpacer(4);
    text(w, `${money0(j.spent)} spent`, Font.systemFont(12), C.muted);
    return w;
  }

  // header: period + spent  |  week
  const head = row(w);
  const hl = head.addStack(); hl.layoutVertically();
  text(hl, `${md(j.from)} – ${md(j.to)}`, Font.systemFont(12), C.muted);
  const sp = row(hl);
  text(sp, money(j.spent), Font.semiboldSystemFont(12), C.text);
  text(sp, ' spent', Font.systemFont(12), C.muted);
  head.addSpacer();
  const hr = head.addStack(); hr.layoutVertically();
  const hr1 = row(hr); hr1.addSpacer(); text(hr1, `Week ${j.week} of 4`, Font.systemFont(12), C.muted);
  const ws = plusDays(j.from, 7 * (j.week - 1)), we = j.week === 4 ? j.to : plusDays(ws, 6);
  const hr2 = row(hr); hr2.addSpacer(); text(hr2, stale ? 'offline' : `${md(ws)} – ${md(we)}`, Font.systemFont(12), C.muted);

  w.addSpacer(family === 'large' ? 14 : 6);

  // big number
  const big = row(w); big.addSpacer();
  text(big, money(left), Font.boldSystemFont(family === 'large' ? 44 : 34), neg ? C.red : C.green, { scale: 0.5 });
  big.addSpacer();
  const sub = row(w); sub.addSpacer();
  text(sub, `left this week · of ${money(j.weekAllowance)}`, Font.systemFont(13), C.muted);
  sub.addSpacer();

  if (family !== 'large') return w;

  // the 4 weeks
  w.addSpacer(14);
  const weeks = row(w);
  (j.weeks || []).forEach((v, i) => {
    if (i) weeks.addSpacer(6);
    const b = weeks.addStack(); b.layoutVertically();
    b.backgroundColor = C.card; b.cornerRadius = 8; b.setPadding(6, 4, 6, 4);
    b.borderWidth = 1; b.borderColor = i + 1 === j.week ? C.text : C.line;
    b.size = new Size(68, 44);
    const past = i + 1 < j.week;
    const l1 = row(b); l1.addSpacer(); text(l1, `W${i + 1}`, Font.systemFont(11), C.muted); l1.addSpacer();
    const l2 = row(b); l2.addSpacer();
    text(l2, money0(v), Font.semiboldSystemFont(14), v < -0.4 ? C.red : past ? C.muted : C.text); l2.addSpacer();
  });
  w.addSpacer(8);
  const ml = row(w); ml.addSpacer();
  text(ml, `${money(j.monthLeft)} left until ${md(j.nextPayday)}`, Font.systemFont(12), j.monthLeft < 0 ? C.red : C.muted);
  ml.addSpacer();

  // top categories this period
  w.addSpacer(14);
  const cats = (j.categories || []).slice(0, 4);
  text(w, 'THIS PERIOD', Font.semiboldSystemFont(11), C.muted);
  w.addSpacer(6);
  if (!cats.length) text(w, 'No purchases yet this period', Font.systemFont(13), C.muted);
  cats.forEach((c, i) => {
    if (i) w.addSpacer(5);
    const r = row(w);
    text(r, c.name, Font.systemFont(14), C.text);
    r.addSpacer();
    text(r, money(c.amount), Font.mediumSystemFont(14), C.text);
  });
  w.addSpacer();
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
