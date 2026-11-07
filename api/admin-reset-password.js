/* تغيير باسورد طالب من لوحة الإدارة.
   بيتغير في المستوى اللي الأدمن فيه، وكمان في المستوى التاني لو الطالب عنده حساب هناك بنفس الإيميل. */
const { appFor, syncPasswordToOtherLevel, cors, getAuth, getDatabase } = require('../lib/levels');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'غير مصرح' });

    const { targetUid, newPassword } = req.body || {};
    const level = parseInt((req.body && req.body.level) || 2, 10); // النسخ القديمة من الصفحة ما بتبعتش level = المستوى الثاني

    const app = appFor(level);
    const auth = getAuth(app);
    const db = getDatabase(app);

    // التوكن لازم يكون من نفس مشروع المستوى، واللي بيغيّر لازم يكون أدمن أو مالك في المستوى ده
    const decoded = await auth.verifyIdToken(token);
    const [adminCheck, ownerCheck] = await Promise.all([
      db.ref(`users/${decoded.uid}/isAdmin`).once('value'),
      db.ref(`users/${decoded.uid}/isOwner`).once('value')
    ]);
    if (adminCheck.val() !== true && ownerCheck.val() !== true) {
      return res.status(403).json({ error: 'مخصص للمدير فقط' });
    }

    if (!targetUid || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'الباسورد يجب ألا يقل عن 6 أحرف' });
    }

    await auth.updateUser(targetUid, { password: newPassword });

    // نفس الطالب في المستوى التاني (لو عنده حساب هناك بنفس الإيميل)
    let sync = { synced: false };
    try {
      const target = await auth.getUser(targetUid);
      sync = await syncPasswordToOtherLevel(level, target.email, newPassword, { skipStaff: true });
    } catch (e) { sync = { synced: false, reason: 'error' }; }

    return res.status(200).json({
      success: true,
      message: 'تم تغيير الباسورد بنجاح',
      synced: !!sync.synced,
      syncedLevel: sync.level || null,
      syncReason: sync.reason || null
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'خطأ بالسيرفر' });
  }
};
