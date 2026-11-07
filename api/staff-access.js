/* المالك بيدي (أو بيسحب) صلاحيات لحد في المستوى التاني وهو قاعد في مستواه.
   الشخص بيتعرف بالإيميل، ولازم يكون عنده حساب في المستوى التاني.
   الحماية: اللي بيطلب لازم يكون "مالك" في المستوى اللي هو فيه، وكمان مالك في المستوى التاني بنفس الإيميل. */
const { otherLevel, hasLevel, whoIs, appFor, cors, getAuth, getDatabase } = require('../lib/levels');

const LEVEL_NAME = { 1: 'المستوى الأول', 2: 'المستوى الثاني' };

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body || {};
    const level = parseInt(body.level || 2, 10);
    const target = otherLevel(level);
    const me = await whoIs(level, req);
    if (!me.isOwner) return res.status(403).json({ error: 'ده للمالك بس' });
    if (!hasLevel(target)) return res.status(400).json({ error: LEVEL_NAME[target] + ' مش متجهز على السيرفر' });

    const tApp = appFor(target), tAuth = getAuth(tApp), tDb = getDatabase(tApp);

    // لازم تكون مالك في المستوى التاني كمان
    let meThere;
    try { meThere = await tAuth.getUserByEmail(me.email); } catch (e) { meThere = null; }
    const meThereData = meThere ? ((await tDb.ref('users/' + meThere.uid).once('value')).val() || {}) : {};
    if (!meThere || meThereData.isOwner !== true) return res.status(403).json({ error: 'لازم تكون مالك في ' + LEVEL_NAME[target] + ' كمان بنفس الإيميل' });

    const email = String(body.targetEmail || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'الشخص ده مالوش إيميل في بياناته' });
    let tu;
    try { tu = await tAuth.getUserByEmail(email); }
    catch (e) { return res.status(404).json({ error: 'الشخص ده مالوش حساب في ' + LEVEL_NAME[target] + '. خليه يدخل ' + LEVEL_NAME[target] + ' مرة بنفس الإيميل وبعدين جرب تاني.' }); }
    const prof = (await tDb.ref('users/' + tu.uid).once('value')).val();
    if (!prof) return res.status(404).json({ error: 'حسابه في ' + LEVEL_NAME[target] + ' مش مكتمل' });
    if (prof.isOwner === true) return res.status(400).json({ error: 'ده المالك، مينفعش تغيّر صلاحياته' });

    const by = 'من ' + LEVEL_NAME[level];
    if (body.action === 'revoke') {
      await tDb.ref('users/' + tu.uid).update({ isAdmin: null, isLeader: null, rankLabel: null });
      await tDb.ref('staff_perms/' + tu.uid).remove();
      await tDb.ref('access_audit').push({ by: me.name, byUid: meThere.uid, target: prof.name || '', targetUid: tu.uid, action: 'سحب كل الصلاحيات', details: by, ts: Date.now() });
      return res.status(200).json({ success: true });
    }

    // منح / تعديل: نفس شكل البيانات اللي لوحة الصلاحيات بتكتبه
    const perms = {};
    Object.keys(body.perms || {}).forEach(k => { if (/^[a-z]+_[a-z]+$/.test(k)) perms[k] = body.perms[k] === true; });
    const upd = { rankLabel: (String(body.label || '').trim().slice(0, 40)) || null };
    if (prof.isAdmin !== true) upd.isLeader = true;
    await tDb.ref('staff_perms/' + tu.uid).set(perms);
    await tDb.ref('users/' + tu.uid).update(upd);
    const n = Object.keys(perms).filter(k => perms[k]).length;
    await tDb.ref('access_audit').push({ by: me.name, byUid: meThere.uid, target: prof.name || '', targetUid: tu.uid, action: 'منح صلاحيات', details: n + ' صلاحية — ' + by + (upd.rankLabel ? ' — ' + upd.rankLabel : ''), ts: Date.now() });
    return res.status(200).json({ success: true, count: n });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'خطأ بالسيرفر' });
  }
};
