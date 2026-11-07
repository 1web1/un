/* إعدادات المستويين على السيرفر (Vercel).
   كل مستوى له مشروع Firebase مستقل، ومفتاحه السري في متغيرات Vercel:
     FIREBASE_SERVICE_ACCOUNT      ← المستوى الثاني
     FIREBASE_SERVICE_ACCOUNT_L1   ← المستوى الأول
   apiKey هنا هو نفس المفتاح العام اللي في index.html (مش سري). */
const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

const LEVELS = {
  1: {
    env: 'FIREBASE_SERVICE_ACCOUNT_L1',
    apiKey: 'AIzaSyAD8cWslM7S60HghPr_qA1Eh2UG04fxQtI',
    databaseURL: 'https://airo-uni-youth-care-v2-default-rtdb.firebaseio.com'
  },
  2: {
    env: 'FIREBASE_SERVICE_ACCOUNT',
    apiKey: 'AIzaSyB6FXWiprXlv6eoLhRIDrwyzKmR9cf3F8Y',
    databaseURL: 'https://university-platform-f51a1-default-rtdb.firebaseio.com'
  }
};

const otherLevel = (l) => (l === 1 ? 2 : 1);
const hasLevel = (l) => !!(LEVELS[l] && process.env[LEVELS[l].env]);

function appFor(level) {
  const cfg = LEVELS[level];
  if (!cfg) throw Object.assign(new Error('مستوى غير معروف'), { status: 400 });
  const name = 'level' + level;
  if (getApps().some(a => a.name === name)) return getApp(name);
  const raw = process.env[cfg.env];
  if (!raw) throw Object.assign(new Error('مفتاح Firebase للمستوى ' + level + ' مش متضاف في Vercel (' + cfg.env + ')'), { status: 500 });
  return initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: cfg.databaseURL }, name);
}

/* نفس الطالب في المستوى التاني = حساب بنفس الإيميل. بنغيّر الباسورد بتاعه هناك كمان.
   skipStaff: ما نلمسش حسابات الأدمن/الليدر/المالك في المستوى التاني (حماية لو حد عمل حساب بإيميل حد تاني). */
async function syncPasswordToOtherLevel(fromLevel, email, password, opts) {
  const o = otherLevel(fromLevel);
  if (!email) return { synced: false, reason: 'no-email' };
  if (!hasLevel(o)) return { synced: false, reason: 'no-level' };
  const app = appFor(o);
  const auth = getAuth(app);
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (e) { if (e && e.code === 'auth/user-not-found') return { synced: false, reason: 'no-account' }; throw e; }
  if (opts && opts.skipStaff) {
    const v = (await getDatabase(app).ref('users/' + user.uid).once('value')).val() || {};
    if (v.isAdmin === true || v.isOwner === true || v.isLeader === true) return { synced: false, reason: 'staff' };
  }
  await auth.updateUser(user.uid, { password });
  return { synced: true, level: o };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

module.exports = { LEVELS, otherLevel, hasLevel, appFor, syncPasswordToOtherLevel, cors, getAuth, getDatabase };
