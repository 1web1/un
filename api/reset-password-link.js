/* الطالب بيغيّر الباسورد برابط الاستعادة اللي وصله على الإيميل.
   الرابط نفسه بيثبت إن الإيميل ده بتاعه، فبعد ما الباسورد يتغير في المستوى بتاع الرابط
   بنغيّره كمان في المستوى التاني لو عنده حساب هناك بنفس الإيميل. */
const { LEVELS, otherLevel, syncPasswordToOtherLevel, cors } = require('../lib/levels');

const CODE_MAP = {
  EXPIRED_OOB_CODE: 'auth/expired-action-code',
  INVALID_OOB_CODE: 'auth/invalid-action-code',
  USER_DISABLED: 'auth/user-disabled',
  WEAK_PASSWORD: 'auth/weak-password'
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { oobCode, newPassword, apiKey, level } = req.body || {};
    if (!oobCode) return res.status(400).json({ error: 'الرابط مش صحيح', code: 'auth/invalid-action-code' });
    if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'كلمة المرور 6 أحرف على الأقل', code: 'auth/weak-password' });

    // المستوى بيتعرف من apiKey اللي في الرابط، ولو مش موجود نجرب مستوى الصفحة وبعدين التاني
    const all = Object.keys(LEVELS).map(Number);
    const byKey = all.find(l => LEVELS[l].apiKey === apiKey);
    const pl = parseInt(level, 10);
    const order = byKey ? [byKey] : (LEVELS[pl] ? [pl, otherLevel(pl)] : all);

    let lastErr = 'INVALID_OOB_CODE';
    for (const l of order) {
      const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=' + LEVELS[l].apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Referer': 'https://dafa3edu.vercel.app/' },
        body: JSON.stringify({ oobCode, newPassword: String(newPassword) })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.email) {
        let sync = { synced: false };
        try { sync = await syncPasswordToOtherLevel(l, j.email, String(newPassword), { skipStaff: false }); } catch (e) {}
        return res.status(200).json({ success: true, level: l, synced: !!sync.synced, syncedLevel: sync.level || null });
      }
      lastErr = String((j.error && j.error.message) || lastErr);
      if (!/INVALID_OOB_CODE/.test(lastErr)) break; // منتهي / ضعيف / متوقف: مفيش داعي نجرب المستوى التاني
    }
    const key = Object.keys(CODE_MAP).find(k => lastErr.indexOf(k) === 0);
    return res.status(400).json({ error: lastErr, code: key ? CODE_MAP[key] : 'auth/internal-error' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'خطأ بالسيرفر', code: 'auth/internal-error' });
  }
};
