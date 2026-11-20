/* نسخة المواد للضيف (تصفح من غير حساب): أسامي بس.
   بنختار الحقول المسموحة بالاسم (whitelist)، فأي حقل جديد يتضاف بعدين (لينك/سؤال/إجابة) مش هيوصل للضيف.
   المستخبي (hidden) بيتشال، والصور (images) ما بتتبعتش خالص. */
const SUBJECT = ['name', 'desc', 'level', 'order', 'cover'];
const CHAPTER = ['name', 'parent', 'order', 'createdAt'];
const FILE = ['title', 'category', 'chapter', 'createdAt', 'order', 'cover'];
const VIDEO = ['title', 'category', 'chapter', 'createdAt', 'order'];
const QUIZ = ['chapter'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function pick(src, keys) {
  const out = {};
  keys.forEach(k => { if (src[k] !== undefined && src[k] !== null) out[k] = src[k]; });
  return out;
}
function mapItems(obj, keys, dropHidden) {
  const out = {};
  if (!isObj(obj)) return out;
  Object.keys(obj).forEach(id => {
    const v = obj[id];
    if (!isObj(v) || (dropHidden && v.hidden)) return;
    out[id] = pick(v, keys);
  });
  return out;
}

function sanitizeSubjects(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  Object.keys(raw).forEach(id => {
    const s = raw[id];
    if (!isObj(s)) return;
    const o = pick(s, SUBJECT);
    if (s.chapters !== undefined) o.chapters = mapItems(s.chapters, CHAPTER, false);
    if (s.files !== undefined) o.files = mapItems(s.files, FILE, true);
    if (s.videos !== undefined) o.videos = mapItems(s.videos, VIDEO, true);
    if (s.quizzes !== undefined) o.quizzes = mapItems(s.quizzes, QUIZ, false);
    out[id] = o;
  });
  return out;
}

module.exports = { sanitizeSubjects };
