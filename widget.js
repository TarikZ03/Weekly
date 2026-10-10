// Weekly — home-screen widget for the Scriptable app (https://scriptable.app).
// Easiest: in the Weekly app tap Edit → "Copy widget script" (fills in your URL and key), then paste
// into a new Scriptable script. Works in any widget size.
// Shows what's left this week and what's been spent this pay period; refreshes about every
// 15 minutes (iOS decides exactly when).

const API_URL = '__URL__';
const KEY = '__KEY__';

const C = {
  bg: Color.dynamic(new Color('#F7F8FA'), new Color('#111214')),
  text: Color.dynamic(new Color('#2B2E34'), new Color('#ECEDEF')),
  muted: Color.dynamic(new Color('#8A8F98'), new Color('#8E939C')),
  green: Color.dynamic(new Color('#22A06B'), new Color('#4CC38A')),
  red: Color.dynamic(new Color('#D9365E'), new Color('#F0698A')),
};
const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const money = n => eur.format(Math.abs(n) < .005 ? 0 : n);

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

  const { j, error } = await load();
  if (error) {
    text(w, 'Weekly', Font.semiboldSystemFont(15), C.muted);
    w.addSpacer(6);
    text(w, error, Font.mediumSystemFont(15), C.red);
    return w;
  }

  // Just two numbers: what's left this week (big), and what's been spent this period (small).
  const size = { small: 34, medium: 44, large: 56 }[family] || 56;
  const label = Math.max(13, size / 3.5), total = Math.max(14, size / 3);
  w.addSpacer();
  const big = row(w); big.addSpacer();
  text(big, money(j.weekLeft), Font.boldSystemFont(size), j.weekLeft < -0.004 ? C.red : C.green, { scale: 0.4 });
  big.addSpacer();
  const l1 = row(w); l1.addSpacer();
  text(l1, 'left this week', Font.systemFont(label), C.muted);
  l1.addSpacer();
  w.addSpacer(family === 'small' ? 8 : size / 2.5);
  const l2 = row(w); l2.addSpacer();
  text(l2, money(j.spent), Font.semiboldSystemFont(total), C.text);
  text(l2, ' spent so far', Font.systemFont(total), C.muted);
  l2.addSpacer();
  w.addSpacer();
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
