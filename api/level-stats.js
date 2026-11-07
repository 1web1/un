/* أرقام المنصتين للوحة الإدارة (لأي حد من الفريق في أي مستوى):
   لكل مستوى: عدد الطلاب، منهم كام جاي من المستوى التاني، وكام متصل دلوقتي (ومستواهم الأصلي).
   بنستخدم قراءات خفيفة: مفاتيح بس للطلبة (shallow) + عقدة المتصلين الصغيرة + عقدة guests الصغيرة. */
const { LEVELS, hasLevel, whoIs, shallowKeys, appFor, cors, getDatabase } = require('../lib/levels');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const level = parseInt((req.body && req.body.level) || 2, 10);
    const me = await whoIs(level, req);
    if (!(me.isAdmin || me.isLeader)) return res.status(403).json({ error: 'للإدارة بس' });

    const out = {};
    for (const l of Object.keys(LEVELS).map(Number)) {
      if (!hasLevel(l)) { out[l] = null; continue; }
      try {
        const db = getDatabase(appFor(l));
        const [userKeys, guestsSnap, onlineSnap] = await Promise.all([
          shallowKeys(l, 'users'),
          db.ref('guests').once('value'),
          db.ref('online_users').once('value')
        ]);
        const users = new Set(userKeys);
        const guestsMap = guestsSnap.val() || {};
        const guestIds = Object.keys(guestsMap).filter(uid => users.has(uid));
        const online = onlineSnap.val() || {};
        let onNative = 0, onGuest = 0;
        Object.keys(online).forEach(uid => {
          const hl = parseInt((online[uid] && online[uid].hl) || guestsMap[uid] || l, 10);
          if (hl === l) onNative++; else onGuest++;
        });
        out[l] = {
          total: users.size,
          guests: guestIds.length,
          natives: users.size - guestIds.length,
          online: onNative + onGuest,
          onlineNative: onNative,
          onlineGuest: onGuest
        };
      } catch (e) { out[l] = { error: e.message || 'error' }; }
    }
    return res.status(200).json({ levels: out, at: Date.now() });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'خطأ بالسيرفر' });
  }
};
