/**
 * 社團申請表單 PDF 接收端(Google Apps Script)
 * 網頁產生 PDF 時會自動把檔案送到這裡,依「表單種類 / 社團」分資料夾存進「你的」Google 雲端:
 *
 *   社團申請表單 /
 *     場地借用單 / 儀隊 / 20261110-010425_場地借用單_儀隊_2026-12-04.pdf
 *     家長同意書 / 儀隊 / 20261110-020328_家長同意書_儀隊_115年12月.pdf
 *     其他 / ...(檔名不是上面兩種時)
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
const TYPES = ['場地借用單', '家長同意書'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents);
    if (!TOKEN || d.token !== TOKEN) return out_({ ok: false, error: 'bad token' });
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
    folder = child_(folder, kind.type);
    if (kind.club) folder = child_(folder, kind.club);
    const file = folder.createFile(Utilities.newBlob(bytes, 'application/pdf', name));
    return out_({ ok: true, name: name, folder: kind.type + (kind.club ? '/' + kind.club : ''), url: file.getUrl() });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet() { return out_({ ok: true, msg: 'upload endpoint ready' }); }

// 由檔名判斷種類與社團,例如「家長同意書_儀隊_115年12月.pdf」→ 家長同意書 / 儀隊
function classify_(filename, d) {
  let type = '其他', club = '';
  const m = filename.match(/^(場地借用單|家長同意書)_([^_]+?)(?:_|\.pdf$)/i);
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
