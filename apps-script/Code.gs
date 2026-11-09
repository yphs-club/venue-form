/**
 * 社團申請表單 PDF 接收端(Google Apps Script)
 * 網頁產生 PDF 時會自動把檔案送到這裡,依「社團 / 表單種類」分資料夾存進「你的」Google 雲端:
 *
 *   社團申請表單 /
 *     儀隊 /
 *       場地借用單 / 20261110-010425_場地借用單_儀隊_2026-12-04.pdf
 *       家長同意書 / 20261110-020328_家長同意書_儀隊_115年12月.pdf
 *     未填社團 / 場地借用單 / ...(網頁沒填社團名稱時)
 *     其他 / ...(檔名不是借用單、同意書或活動申請表時)
 *
 * 設定:
 * 1) 把 TOKEN 改成你自己的通關碼(要和網頁 index.html、consent.html 裡的 UPLOAD_TOKEN 相同)。
 * 2) 部署 → 新增部署 → 類型「網頁應用程式」
 *      執行身分:我
 *      誰可以存取:所有人
 * 3) 複製部署後的網址,貼到網頁的 UPLOAD_URL。
 * 之後更新程式:部署 → 管理部署作業 → 編輯(鉛筆)→ 版本選「新版本」→ 部署(網址不會變)。
 */
const TOKEN = '請改成你自己的通關碼';
const ROOT_NAME = '社團申請表單';          // 會自動在雲端最上層建立這個資料夾
const MAX_BASE64_CHARS = 8 * 1024 * 1024;  // 約 6MB,超過就拒收
const TYPES = ['場地借用單', '家長同意書', '活動申請表'];
const TEACHER_PASS = '請改成學務處密碼';        // 學務處產生家長同意書的頁面要輸入的密碼(不要和 TOKEN 相同)
const DATA_DIR = '_活動申請資料';              // 學生送出的活動申請資料(JSON),學務處頁面由這裡讀取

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === 'mark') return mark_(d);
    if (!TOKEN || d.token !== TOKEN) return out_({ ok: false, error: 'bad token' });
    if (d.action === 'saveApp') return saveApp_(d);
    if (!d.base64 || d.base64.length > MAX_BASE64_CHARS) return out_({ ok: false, error: 'bad size' });
    const bytes = Utilities.base64Decode(d.base64);
    if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') {
      return out_({ ok: false, error: 'not a pdf' });
    }
    const filename = safeName_(d.filename || '未命名.pdf');
    const kind = classify_(filename, d);
    const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');
    const name = stamp + '_' + filename;

    lock.waitLock(20000);                       // 避免同時上傳時重複建立資料夾
    let folder = child_(DriveApp.getRootFolder(), ROOT_NAME);
    let path;
    if (kind.type === '其他') {                  // 不是借用單/同意書:放在「其他」
      folder = child_(folder, '其他');
      path = '其他';
    } else {                                    // 社團 → 表單種類
      const club = kind.club || '未填社團';
      folder = child_(child_(folder, club), kind.type);
      path = club + '/' + kind.type;
    }
    const file = folder.createFile(Utilities.newBlob(bytes, 'application/pdf', name));
    return out_({ ok: true, name: name, folder: path, url: file.getUrl() });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'list') {                        // 學務處:列出學生送出的活動申請
    if (!TEACHER_PASS || p.pass !== TEACHER_PASS) return out_({ ok: false, error: 'bad password' });
    const dir = dataDir_(), items = [], it = dir.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      try {
        const o = JSON.parse(f.getBlob().getDataAsString());
        items.push({ id: o.id, savedAt: o.savedAt, done: f.getDescription() === 'done', data: o.data });
      } catch (x) {}
    }
    items.sort(function (a, b) { return a.savedAt < b.savedAt ? 1 : -1; });
    return out_({ ok: true, items: items.slice(0, 200) });
  }
  return out_({ ok: true, msg: 'upload endpoint ready' });
}

function dataDir_() { return child_(child_(DriveApp.getRootFolder(), ROOT_NAME), DATA_DIR); }
function findApp_(dir, id) {
  const it = dir.getFilesByName(id + '.json');
  return it.hasNext() ? it.next() : null;
}
// 學生下載申請表時一併送出申請資料(同一份申請重複下載會覆蓋同一個檔)
function saveApp_(d) {
  const id = String(d.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
  if (!id || !d.data || typeof d.data !== 'object') return out_({ ok: false, error: 'bad data' });
  const text = JSON.stringify({ id: id, savedAt: Utilities.formatDate(new Date(), 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ss"), data: d.data });
  if (text.length > 200000) return out_({ ok: false, error: 'too large' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const dir = dataDir_(), old = findApp_(dir, id);
    if (old) old.setContent(text); else dir.createFile(id + '.json', text, 'application/json');
  } finally { try { lock.releaseLock(); } catch (x) {} }
  return out_({ ok: true, id: id });
}
// 學務處:標記某份申請「已產生家長同意書」
function mark_(d) {
  if (!TEACHER_PASS || d.pass !== TEACHER_PASS) return out_({ ok: false, error: 'bad password' });
  const f = findApp_(dataDir_(), String(d.id || '').replace(/[^A-Za-z0-9]/g, ''));
  if (!f) return out_({ ok: false, error: 'not found' });
  f.setDescription(d.done === false ? '' : 'done');
  return out_({ ok: true });
}

// 由檔名判斷種類與社團,例如「家長同意書_儀隊_115年12月.pdf」→ 家長同意書 / 儀隊
function classify_(filename, d) {
  let type = '其他', club = '';
  const m = filename.match(/^(場地借用單|家長同意書|活動申請表)_([^_]+?)(?:_|\.pdf$)/i);
  if (m) { type = m[1]; club = m[2]; }
  if (d && d.type && TYPES.indexOf(String(d.type)) >= 0) type = String(d.type);
  if (d && d.club) club = clean_(d.club);
  if (club === '未填社團') club = '';
  return { type: type, club: club };
}

function child_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function clean_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 40);
}
function safeName_(s) {
  s = String(s).replace(/[\\\/:*?"<>|\r\n]+/g, '_').slice(0, 80);
  return /\.pdf$/i.test(s) ? s : s + '.pdf';
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
