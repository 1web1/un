/* إشعارات الموبايل: مفتاح عام + اشتراك/إلغاء للطالب + عدد وإرسال للإدارة.
   كل المنطق في lib/push.js — هنا بس بنوصّله بـ Firebase و web-push. */
const webpush = require('web-push');
const { LEVELS, hasLevel, appFor, whoIs, cors, getAuth, getDatabase } = require('../lib/levels');
const { makeHandler } = require('../lib/push');

function store(level) {
  const db = getDatabase(appFor(level));
  return {
    get: async p => (await db.ref(p).once('value')).val(),
    set: (p, v) => db.ref(p).set(v),
    remove: p => db.ref(p).remove(),
    txn: async (p, fn) => { const r = await db.ref(p).transaction(fn); return { committed: r.committed, value: r.snapshot.val() }; }
  };
}

async function verifyUid(level, req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) throw Object.assign(new Error('سجّل دخول الأول'), { status: 401 });
  return (await getAuth(appFor(level)).verifyIdToken(token)).uid;
}

let handler = null;
function getHandler() {
  if (handler) return handler;
  const levels = Object.keys(LEVELS).map(Number).filter(hasLevel);
  handler = makeHandler({
    levels,
    homeLevel: levels.indexOf(2) >= 0 ? 2 : levels[0],
    store, verifyUid, whoIs, webpush,
    now: () => Date.now(),
    subject: 'https://' + (process.env.VERCEL_PROJECT_PRODUCTION_URL || 'un-platform.vercel.app')
  }).handle;
  return handler;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const out = await getHandler()(req.body, req);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(out);
  } catch (err) {
    const status = err.status || (err.code && String(err.code).indexOf('auth/') === 0 ? 401 : 500);
    return res.status(status).json({ error: err.message || 'خطأ بالسيرفر', waitMin: err.waitMin });
  }
};
