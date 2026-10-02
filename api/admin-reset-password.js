const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: "https://university-platform-f51a1-default-rtdb.firebaseio.com"
  });
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

    const auth = getAuth();
    const db = getDatabase();

    const decoded = await auth.verifyIdToken(token);
    const adminCheck = await db.ref(`users/${decoded.uid}/isAdmin`).once('value');
    if (adminCheck.val() !== true) {
      return res.status(403).json({ error: 'مخصص للمدير فقط' });
    }

    const { targetUid, newPassword } = req.body;
    if (!targetUid || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'الباسورد يجب ألا يقل عن 6 أحرف' });
    }

    await auth.updateUser(targetUid, { password: newPassword });
    return res.status(200).json({ success: true, message: 'تم تغيير الباسورد بنجاح' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'خطأ بالسيرفر' });
  }
};
