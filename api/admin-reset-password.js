const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

/* كل مستوى له مشروع Firebase مستقل.
   متغيرات البيئة في Vercel:
     FIREBASE_SERVICE_ACCOUNT      ← مفتاح مشروع المستوى الثاني (الموجود حالياً)
     FIREBASE_SERVICE_ACCOUNT_L1   ← مفتاح مشروع المستوى الأول (الجديد)
   رابط قاعدة البيانات بيتاخد تلقائي من project_id اللي جوه المفتاح. */
const LEVELS = {
  1: { env: 'FIREBASE_SERVICE_ACCOUNT_L1' },
  2: { env: 'FIREBASE_SERVICE_ACCOUNT', databaseURL: 'https://university-platform-f51a1-default-rtdb.firebaseio.com' }
};

function appFor(level) {
  const cfg = LEVELS[level];
  if (!cfg) throw Object.assign(new Error('مستوى غير معروف'), { status: 400 });
  const name = 'level' + level;
  if (getApps().some(a => a.name === name)) return getApp(name);
  const raw = process.env[cfg.env];
  if (!raw) throw Object.assign(new Error('مفتاح Firebase للمستوى ' + level + ' مش متضاف في Vercel (' + cfg.env + ')'), { status: 500 });
  const sa = JSON.parse(raw);
  return initializeApp({
    credential: cert(sa),
    databaseURL: cfg.databaseURL || ('https://' + sa.project_id + '-default-rtdb.firebaseio.com')
  }, name);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'غير مصرح' });

    const { targetUid, newPassword } = req.body || {};
    const level = parseInt((req.body && req.body.level) || 2, 10); // النسخ القديمة من الصفحة ما بتبعتش level = المستوى الثاني

    const app = appFor(level);
    const auth = getAuth(app);
    const db = getDatabase(app);

    // التوكن لازم يكون من نفس مشروع المستوى، والأدمن لازم يكون أدمن في المستوى ده
    const decoded = await auth.verifyIdToken(token);
    const adminCheck = await db.ref(`users/${decoded.uid}/isAdmin`).once('value');
    if (adminCheck.val() !== true) {
      return res.status(403).json({ error: 'مخصص للمدير فقط' });
    }

    if (!targetUid || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'الباسورد يجب ألا يقل عن 6 أحرف' });
    }

    await auth.updateUser(targetUid, { password: newPassword });
    return res.status(200).json({ success: true, message: 'تم تغيير الباسورد بنجاح' });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'خطأ بالسيرفر' });
  }
};
