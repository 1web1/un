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

    // التوكن لازم يكون من نفس مشروع المستوى. المسموح: المالك، أو الأدمن (لو عنده صلاحيات مخصصة لازم students_password)،
    // أو الليدر لو المالك اداله students_password صراحةً — نفس اللي لوحة الإدارة بتعرضه.
    const decoded = await auth.verifyIdToken(token);
    const flag = (uid, k) => db.ref(`users/${uid}/${k}`).once('value').then(s => s.val() === true);
    const [isAdmin, isOwner, isLeader, permsSnap] = await Promise.all([
      flag(decoded.uid, 'isAdmin'), flag(decoded.uid, 'isOwner'), flag(decoded.uid, 'isLeader'),
      db.ref(`staff_perms/${decoded.uid}`).once('value')
    ]);
    const perms = permsSnap.val();
    const hasCustom = perms && typeof perms === 'object';
    const allowed = isOwner || (isAdmin && (!hasCustom || perms.students_password === true)) || (isLeader && hasCustom && perms.students_password === true);
    if (!allowed) return res.status(403).json({ error: 'مش معاك صلاحية تغيير الباسورد' });

    if (typeof targetUid !== 'string' || !targetUid || targetUid.length > 128 || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'الباسورد يجب ألا يقل عن 6 أحرف' });
    }

    // باسورد المالك أو أي حد من الإدارة: المالك بس اللي يغيّره (حماية من الاستيلاء على الحسابات)
    if (!isOwner) {
      const [tOwner, tAdmin, tLeader] = await Promise.all([flag(targetUid, 'isOwner'), flag(targetUid, 'isAdmin'), flag(targetUid, 'isLeader')]);
      if (tOwner || tAdmin || tLeader) return res.status(403).json({ error: 'باسورد حد من فريق الإدارة بيتغير من المالك بس' });
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
