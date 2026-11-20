/* تصفح المنصة كضيف: بيرجّع المواد بالأسامي بس (من غير لينكات ولا أسئلة).
   GET /api/guest-catalog?level=1|2
   مواد Firebase مقفولة على اللي عامل حساب، فالسيرفر بيقراها بمفتاحه ويشيل أي حاجة سرية (lib/guest-catalog).
   الرد بيتخزن في Vercel 5 دقايق، فقراءة واحدة من Firebase مهما كان عدد الضيوف. */
const { hasLevel, appFor, cors, getDatabase } = require('../lib/levels');
const { sanitizeSubjects } = require('../lib/guest-catalog');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const level = parseInt((req.query && req.query.level) || '2', 10);
    if (!hasLevel(level)) return res.status(400).json({ error: 'مستوى غير معروف' });
    const db = getDatabase(appFor(level));
    const [vis, maint, ui] = await Promise.all([
      db.ref('public/visible').once('value'),
      db.ref('settings/maintenanceMode').once('value'),
      db.ref('settings/subjectsUI').once('value')   // شكل صفحات المواد (القديم/الجديد) زي الطلاب بالظبط
    ]);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (vis.val() === false) return res.status(200).json({ closed: true });
    if (maint.val() === true) return res.status(200).json({ maintenance: true });
    const subjects = sanitizeSubjects((await db.ref('subjects').once('value')).val());
    return res.status(200).json({ subjects, ui: ui.val() === 'v2' ? 'v2' : 'v1', at: Date.now() });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'خطأ بالسيرفر' });
  }
};
