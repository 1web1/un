/* إشعارات الموبايل (Web Push) — المنطق كله هنا، و api/push.js بيوصّله بـ Firebase الحقيقي.
   - مفاتيح VAPID بتتعمل لوحدها أول مرة وتتحفظ في _server/vapid في قاعدة "البيت" (المستوى التاني لو موجود).
     مفيش قاعدة في firebase-rules بتسمح لأي طالب يقرا _server أو push_subs، فالسيرفر بس (admin SDK) اللي يوصلها.
   - اشتراكات الأجهزة: push_subs/{uid}/{key} و push_ep/{key} = uid (عشان لو موبايل واحد اتفتح بحسابين يفضل مع آخر حساب بس).
   - الإرسال يدوي من الإدارة بس، ومرة كل 10 دقايق لكل مستوى. */
const crypto = require('crypto');

const RATE_MS = 10 * 60 * 1000;
const TTL_SEC = 24 * 60 * 60;
const TITLE_MAX = 60;
const BODY_MAX = 180;
const PUSH_HOSTS = ['googleapis.com', 'mozilla.com', 'notify.windows.com', 'push.apple.com'];
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function httpError(status, message, extra) { return Object.assign(new Error(message), { status }, extra || {}); }
function subKey(endpoint) { return crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32); }

function cleanSubscription(s) {
  const endpoint = s && typeof s.endpoint === 'string' ? s.endpoint : '';
  const keys = (s && s.keys) || {};
  let u;
  try { u = new URL(endpoint); } catch (e) { throw httpError(400, 'اشتراك غير صالح'); }
  const hostOk = PUSH_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  if (u.protocol !== 'https:' || !hostOk || endpoint.length > 1000) throw httpError(400, 'اشتراك غير صالح');
  const p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
  if (!B64URL.test(p256dh) || p256dh.length > 200 || !B64URL.test(auth) || auth.length > 100) throw httpError(400, 'اشتراك غير صالح');
  return { endpoint, p256dh, auth };
}

function cleanText(v, max, what) {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!t) throw httpError(400, 'اكتب ' + what);
  if (t.length > max) throw httpError(400, what + ' طويل (أقصى حد ' + max + ' حرف)');
  return t;
}

/* deps:
   levels: [1,2] المتاحة · homeLevel: مستوى حفظ المفاتيح
   store(level) → { get(path), set(path,v), remove(path), txn(path, fn) → {committed, value} }
   verifyUid(level, req) → uid  (أي حد مسجّل دخول)
   whoIs(level, req) → { uid, name, isOwner, isAdmin, isLeader }
   webpush: { generateVAPIDKeys(), sendNotification(sub, payload, opts) }
   now(): رقم */
function makeHandler(deps) {
  let vapidCache = null;

  async function getVapid() {
    if (vapidCache) return vapidCache;
    const home = deps.store(deps.homeLevel);
    let v = await home.get('_server/vapid');
    if (!v || !v.publicKey || !v.privateKey) {
      const fresh = deps.webpush.generateVAPIDKeys();
      const r = await home.txn('_server/vapid', cur => (cur && cur.publicKey && cur.privateKey) ? undefined : { publicKey: fresh.publicKey, privateKey: fresh.privateKey, at: deps.now() });
      v = r.value || (await home.get('_server/vapid'));
    }
    vapidCache = { publicKey: v.publicKey, privateKey: v.privateKey };
    return vapidCache;
  }

  async function canSend(level, req) {
    const me = await deps.whoIs(level, req);
    if (!(me.isOwner || me.isAdmin || me.isLeader)) throw httpError(403, 'الإشعارات للإدارة بس');
    if (!me.isOwner) {
      const p = await deps.store(level).get('staff_perms/' + me.uid + '/notify_send');
      if (p === false) throw httpError(403, 'مش معاك صلاحية إرسال الإشعارات');
    }
    return me;
  }

  async function countSubs(level) {
    const all = (await deps.store(level).get('push_subs')) || {};
    let n = 0;
    Object.keys(all).forEach(uid => { n += Object.keys(all[uid] || {}).length; });
    return n;
  }

  async function handle(body, req) {
    body = body || {};
    const action = String(body.action || '');
    const level = parseInt(body.level, 10);
    if (action === 'key') return { publicKey: (await getVapid()).publicKey };
    if (deps.levels.indexOf(level) < 0) throw httpError(400, 'مستوى غير معروف');
    const db = deps.store(level);

    if (action === 'subscribe') {
      const uid = await deps.verifyUid(level, req);
      const s = cleanSubscription(body.subscription);
      const key = subKey(s.endpoint);
      const owner = await db.get('push_ep/' + key);
      if (owner && owner !== uid) await db.remove('push_subs/' + owner + '/' + key);
      await db.set('push_subs/' + uid + '/' + key, { e: s.endpoint, p: s.p256dh, a: s.auth, at: deps.now() });
      await db.set('push_ep/' + key, uid);
      return { ok: true };
    }

    if (action === 'unsubscribe') {
      const uid = await deps.verifyUid(level, req);
      const key = subKey(String(body.endpoint || ''));
      await db.remove('push_subs/' + uid + '/' + key);
      if ((await db.get('push_ep/' + key)) === uid) await db.remove('push_ep/' + key);
      return { ok: true };
    }

    if (action === 'count') {
      await canSend(level, req);
      return { count: await countSubs(level) };
    }

    if (action === 'send') {
      const me = await canSend(level, req);
      const title = cleanText(body.title, TITLE_MAX, 'عنوان الإشعار');
      const text = cleanText(body.body, BODY_MAX, 'نص الإشعار');
      const sid = body.subjectId ? String(body.subjectId) : '';
      if (sid && !/^[\w-]{1,64}$/.test(sid)) throw httpError(400, 'مادة غير صالحة');

      const t = deps.now();
      const gate = await db.txn('_server/push_last', cur => (cur && t - cur < RATE_MS) ? undefined : t);
      if (!gate.committed) {
        const waitMin = Math.max(1, Math.ceil((RATE_MS - (t - (gate.value || t))) / 60000));
        throw httpError(429, 'فيه إشعار اتبعت من شوية. استنى ' + waitMin + ' دقيقة وابعت تاني', { waitMin });
      }

      /* لو الليدر اختار مادة: اسم المادة يبقى عنوان الإشعار (أوضح حاجة على شاشة القفل)،
         وعنوان الليدر + النص ينزلوا في السطر اللي تحته. الاسم بيتقري من القاعدة مش من المتصفح. */
      let nTitle = title, nBody = text;
      if (sid) {
        const sname = String((await db.get('subjects/' + sid + '/name')) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (sname) { nTitle = '📚 ' + sname; nBody = title + ' — ' + text; }
      }

      const vapid = await getVapid();
      const url = '/?level=' + level + (sid ? '#subject/' + encodeURIComponent(sid) : '');
      const payload = JSON.stringify({ title: nTitle, body: nBody, url, tag: 'dof3aa-' + t });
      const opts = { TTL: TTL_SEC, urgency: 'high', vapidDetails: { subject: deps.subject || 'https://un-platform.vercel.app', publicKey: vapid.publicKey, privateKey: vapid.privateKey } };

      const all = (await db.get('push_subs')) || {};
      const list = [];
      Object.keys(all).forEach(uid => Object.keys(all[uid] || {}).forEach(key => { const s = all[uid][key]; if (s && s.e) list.push({ uid, key, s }); }));

      let sent = 0, failed = 0, removed = 0;
      for (let i = 0; i < list.length; i += 50) {
        const chunk = list.slice(i, i + 50);
        const res = await Promise.allSettled(chunk.map(x => deps.webpush.sendNotification({ endpoint: x.s.e, keys: { p256dh: x.s.p, auth: x.s.a } }, payload, opts)));
        for (let j = 0; j < res.length; j++) {
          if (res[j].status === 'fulfilled') { sent++; continue; }
          const code = res[j].reason && res[j].reason.statusCode;
          if (code === 404 || code === 410) {
            removed++;
            await db.remove('push_subs/' + chunk[j].uid + '/' + chunk[j].key);
            await db.remove('push_ep/' + chunk[j].key);
          } else failed++;
        }
      }
      return { sent, failed, removed, by: me.name || '' };
    }

    throw httpError(400, 'طلب غير معروف');
  }

  return { handle, subKey };
}

module.exports = { makeHandler, subKey, RATE_MS, TTL_SEC };
