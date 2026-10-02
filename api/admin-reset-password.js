const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

// تهيئة Firebase Admin باستخدام المتغير السري من Vercel
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: "https://university-platform-f51a1-default-rtdb.firebaseio.com"
  });
}

module.exports = async (req, res) => {
  // استقبال طلبات POST فقط
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.replace('Bearer ', '');
    if (!idToken) {
      return res.status(401).json({ error: 'غير مصرح: يرجى تسجيل الدخول' });
    }

    const auth = getAuth();
    const db = getDatabase();

    // 1. التحقق من هوية الشخص الذي يطلب التغيير
    const decodedToken = await auth.verifyIdToken(idToken);
    const callerUid = decodedToken.uid;

    // 2. التأكد من قاعدة البيانات أن هذا الشخص أدمن حقيقي
    const adminSnap = await db.ref(`users/${callerUid}/isAdmin`).once('value');
    if (adminSnap.val() !== true) {
      return res.status(403).json({ error: 'عذراً، هذا الإجراء مخصص لمدير المنصة فقط.' });
    }

    // 3. قراءة بيانات الطالب والباسورد الجديد
    const { targetUid, newPassword } = req.body;
    if (!targetUid || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 6 أحرف.' });
    }

    // 4. تغيير كلمة المرور في Firebase Authentication فوراً
    await auth.updateUser(targetUid, {
      password: newPassword
    });

    return res.status(200).json({ success: true, message: 'تم تغيير كلمة المرور بنجاح!' });
  } catch (error) {
    console.error('Error updating password:', error);
    return res.status(500).json({ error: error.message || 'حدث خطأ بالسيرفر' });
  }
};