/**
 * 場地借用單 PDF 接收端(Google Apps Script)
 * 部署後,網頁產生 PDF 時會自動把檔案送到這裡,存進「你的」Google 雲端。
 *
 * 1) 把 TOKEN 改成你自己的通關碼(要和網頁 index.html 裡的 UPLOAD_TOKEN 相同)。
 * 2) 部署 → 新增部署 → 類型「網頁應用程式」
 *      執行身分:我
 *      誰可以存取:所有人
 * 3) 複製部署後的網址,貼到 index.html 的 UPLOAD_URL。
 */
const TOKEN = '請改成你自己的通關碼';
const FOLDER_NAME = '場地借用單';          // 會自動在雲端建立這個資料夾
const MAX_BASE64_CHARS = 8 * 1024 * 1024;  // 約 6MB,超過就拒收

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!TOKEN || d.token !== TOKEN) return out_({ ok: false, error: 'bad token' });
    if (!d.base64 || d.base64.length > MAX_BASE64_CHARS) return out_({ ok: false, error: 'bad size' });
    const bytes = Utilities.base64Decode(d.base64);
    if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') {
      return out_({ ok: false, error: 'not a pdf' });
    }
    const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');
    const name = stamp + '_' + safeName_(d.filename || '場地借用單.pdf');
    const file = folder_().createFile(Utilities.newBlob(bytes, 'application/pdf', name));
    return out_({ ok: true, name: name, url: file.getUrl() });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function doGet() { return out_({ ok: true, msg: 'upload endpoint ready' }); }

function folder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}
function safeName_(s) {
  s = String(s).replace(/[\\\/:*?"<>|\r\n]+/g, '_').slice(0, 80);
  return /\.pdf$/i.test(s) ? s : s + '.pdf';
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
