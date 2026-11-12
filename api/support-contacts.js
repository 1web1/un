/* أرقام الدعم الفني لصفحة تسجيل الدخول / إنشاء حساب (من غير ما الطالب يكون مسجّل دخول).
   بيرجّع الاسم والرقم بس من settings/supportContacts، ومفيش أي بيانات تانية.
   الرد بيتخزن على Vercel 10 دقايق، فالداتابيز مش بتتقري غير مرة كل 10 دقايق تقريباً مهما كان عدد الطلاب. */
const { LEVELS, hasLevel, appFor, getDatabase } = require('../lib/levels');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    let level = parseInt((req.query && req.query.level) || 2, 10);
    if (!LEVELS[level] || !hasLevel(level)) level = hasLevel(2) ? 2 : 1;
    const v = (await getDatabase(appFor(level)).ref('settings/supportContacts').once('value')).val();
    const arr = Array.isArray(v) ? v : (v ? Object.values(v) : []);
    const contacts = arr.slice(0, 3)
      .map(c => ({ label: String((c && c.label) || '').slice(0, 60), phone: String((c && c.phone) || '').slice(0, 30) }))
      .filter(c => c.phone.replace(/\D/g, '').length >= 8);
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
    return res.status(200).json({ contacts });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'مش قادر أجيب أرقام الدعم دلوقتي', contacts: [] });
  }
};
