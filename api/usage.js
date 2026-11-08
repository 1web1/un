/* استهلاك Firebase للمستويين (نفس الأرقام اللي في صفحة Usage في Firebase Console)
   الأرقام بتيجي من Google Cloud Monitoring بمفتاح المشروع اللي في Vercel.
   مسموح للمالك، أو لأي حد المالك اداله صلاحية "متابعة الاستهلاك" (staff_perms/<uid>/usage_view). */
const { LEVELS, hasLevel, whoIs, appFor, keyInfo, cors, getDatabase } = require('../lib/levels');

const M = 'firebasedatabase.googleapis.com/';
const num = (p) => (p && p.value) ? Number(p.value.int64Value != null ? p.value.int64Value : (p.value.doubleValue != null ? p.value.doubleValue : (p.value.boolValue ? 1 : 0))) : null;

async function series(level, metric, hours, agg) {
  const app = appFor(level), { projectId } = keyInfo(level);
  const tok = (await app.options.credential.getAccessToken()).access_token;
  const end = new Date(), start = new Date(end.getTime() - hours * 3600 * 1000);
  const q = new URLSearchParams({ filter: 'metric.type="' + M + metric + '"', 'interval.startTime': start.toISOString(), 'interval.endTime': end.toISOString() });
  if (agg) { q.set('aggregation.alignmentPeriod', agg.period); q.set('aggregation.perSeriesAligner', agg.aligner); if (agg.reducer) q.set('aggregation.crossSeriesReducer', agg.reducer); }
  const r = await fetch('https://monitoring.googleapis.com/v3/projects/' + encodeURIComponent(projectId) + '/timeSeries?' + q.toString(), { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || ('monitoring ' + r.status);
    const disabled = /has not been used|is disabled|SERVICE_DISABLED/i.test(msg) || JSON.stringify(j).indexOf('SERVICE_DISABLED') >= 0;
    throw Object.assign(new Error(msg), { kind: disabled ? 'api_disabled' : (r.status === 403 ? 'no_permission' : 'error') });
  }
  return j.timeSeries || [];
}
const latest = (ts) => { let best = null; (ts || []).forEach(s => { const p = s.points && s.points[0]; const v = num(p); if (v != null) best = (best == null ? v : best + v); }); return best; };

async function levelUsage(level) {
  const { projectId, email } = keyInfo(level);
  const out = { level, projectId };
  try {
    const [monthly, limit, daily, conns, disabled] = await Promise.all([
      series(level, 'network/monthly_sent', 6),
      series(level, 'network/monthly_sent_limit', 6).catch(() => []),
      series(level, 'network/sent_bytes_count', 24 * 15, { period: '86400s', aligner: 'ALIGN_SUM', reducer: 'REDUCE_SUM' }).catch(() => []),
      series(level, 'network/active_connections', 2).catch(() => []),
      series(level, 'network/disabled_for_overages', 6).catch(() => [])
    ]);
    out.monthlyBytes = latest(monthly);
    out.limitBytes = latest(limit);
    out.connections = latest(conns);
    out.disabled = latest(disabled) === 1;
    const pts = (daily[0] && daily[0].points) || [];
    out.daily = pts.map(p => ({ end: p.interval && p.interval.endTime, bytes: num(p) || 0 })).reverse(); // الأقدم الأول
    try {
      const [st, stl] = await Promise.all([series(level, 'storage/total_bytes', 6), series(level, 'storage/limit', 6)]);
      out.storageBytes = latest(st); out.storageLimit = latest(stl);
    } catch (e) {}
  } catch (e) {
    out.error = e.message || 'error';
    out.kind = e.kind || 'error';
    if (out.kind === 'api_disabled') out.fixUrl = 'https://console.cloud.google.com/apis/library/monitoring.googleapis.com?project=' + encodeURIComponent(projectId);
    if (out.kind === 'no_permission') { out.fixUrl = 'https://console.cloud.google.com/iam-admin/iam?project=' + encodeURIComponent(projectId); out.serviceEmail = email; }
  }
  return out;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const level = parseInt((req.body && req.body.level) || 2, 10);
    const me = await whoIs(level, req);
    let allowed = me.isOwner;
    if (!allowed && (me.isAdmin || me.isLeader)) {
      const v = (await getDatabase(me.app).ref('staff_perms/' + me.uid + '/usage_view').once('value')).val();
      allowed = v === true;
    }
    if (!allowed) return res.status(403).json({ error: 'مش معاك صلاحية متابعة الاستهلاك' });

    const levels = {};
    await Promise.all(Object.keys(LEVELS).map(Number).map(async l => { levels[l] = hasLevel(l) ? await levelUsage(l) : { level: l, error: 'المستوى ده مش متجهز على السيرفر', kind: 'error' }; }));
    return res.status(200).json({ levels, at: Date.now() });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'خطأ بالسيرفر' });
  }
};
