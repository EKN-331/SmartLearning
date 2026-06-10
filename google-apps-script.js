/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Smart Learning SD/MI — Google Apps Script API  v2.1       ║
 * ║   PASTE SELURUH KODE INI ke Apps Script, lalu RE-DEPLOY     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * PERBAIKAN v2.1:
 *  ✅ doGet  menangani action=getAll DAN action lain via query param
 *  ✅ doPost membaca dari e.postData.contents (text/plain body)
 *  ✅ Setiap response menyertakan header CORS eksplisit
 *  ✅ Error logging ke console Apps Script agar mudah debug
 *  ✅ Validasi sheet & header otomatis dibuat jika belum ada
 */

// ── GANTI DENGAN SPREADSHEET ID KAMU ──────────────────────────
const SPREADSHEET_ID = '1QXnHifoOp4PZoGQgfl5scAbTI50Vy4TUbbliF9irwX0';
// Contoh: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'
// Ambil dari URL: docs.google.com/spreadsheets/d/[ID_ADA_DI_SINI]/edit
// ──────────────────────────────────────────────────────────────


// =============================================================
// ENTRY POINTS
// =============================================================

/** Menangani GET request — termasuk getAll dan action via query param */
function doGet(e) {
  try {
    const action = e.parameter.action || '';
    const data   = e.parameter.data   ? JSON.parse(e.parameter.data) : {};

    let result;
    if (action === 'getAll' || action === '') {
      result = getAllData();
    } else {
      result = routeAction(action, data);
    }
    return makeResponse({ ok: true, data: result });
  } catch(err) {
    Logger.log('doGet ERROR: ' + err.toString());
    return makeResponse({ ok: false, error: err.toString() });
  }
}

/** Menangani POST request — body berupa JSON string (text/plain) */
function doPost(e) {
  try {
    // Ambil body dari postData.contents
    const raw    = e.postData ? e.postData.contents : '{}';
    const parsed = JSON.parse(raw);
    const action = parsed.action || '';

    Logger.log('doPost action: ' + action + ' | keys: ' + Object.keys(parsed).join(', '));

    const result = routeAction(action, parsed);
    return makeResponse({ ok: true, data: result });
  } catch(err) {
    Logger.log('doPost ERROR: ' + err.toString());
    return makeResponse({ ok: false, error: err.toString() });
  }
}

/** Router: pilih fungsi sesuai action */
function routeAction(action, data) {
  switch (action) {
    case 'getAll':          return getAllData();
    case 'saveQuestion':    return saveRow('questions', data.question);
    case 'deleteQuestion':  return deleteRow('questions', data.id);
    case 'saveSubject':     return saveRow('subjects',   data.subject);
    case 'deleteSubject':   return deleteRow('subjects',  data.id);
    case 'saveHistory':     return saveRow('history',    data.record);
    case 'clearHistory':    return clearSheet('history');
    case 'saveSetting':     return saveSetting(data.key, data.value);
    default:
      throw new Error('Unknown action: ' + action);
  }
}


// =============================================================
// RESPONSE BUILDER
// =============================================================

/**
 * Buat TextOutput JSON dengan header CORS.
 * Apps Script tidak bisa set header secara bebas, tapi
 * ContentService.createTextOutput + MimeType.JSON sudah cukup
 * karena browser akan follow redirect ke googleusercontent.com
 * yang mengizinkan cross-origin reads.
 */
function makeResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// =============================================================
// READ — GET ALL DATA
// =============================================================

function getAllData() {
  ensureSheets(); // pastikan semua sheet & header ada
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return {
    subjects:  sheetToObjects(ss.getSheetByName('subjects')),
    questions: sheetToObjects(ss.getSheetByName('questions')),
    history:   sheetToObjects(ss.getSheetByName('history')),
    settings:  settingsToObject(ss.getSheetByName('settings'))
  };
}


// =============================================================
// WRITE — SAVE / UPDATE ROW
// =============================================================

function saveRow(sheetName, obj) {
  if (!obj || typeof obj !== 'object') throw new Error('saveRow: obj is null/invalid');

  const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet   = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const headers = getHeaders(sheet);
  if (headers.length === 0) throw new Error('Sheet has no headers: ' + sheetName);

  // Build row array sesuai urutan header
  const row = headers.map(h => {
    const val = obj[h];
    if (val === null || val === undefined) return '';
    if (typeof val === 'object')           return JSON.stringify(val);
    return String(val);
  });

  // Cari baris dengan id yang sama → UPDATE
  const idColIdx = headers.indexOf('id');
  if (idColIdx >= 0 && obj.id) {
    const allData = sheet.getDataRange().getValues();
    for (let r = 1; r < allData.length; r++) {
      if (String(allData[r][idColIdx]) === String(obj.id)) {
        sheet.getRange(r + 1, 1, 1, row.length).setValues([row]);
        Logger.log('Updated row in ' + sheetName + ' id=' + obj.id);
        return { action: 'updated', id: obj.id };
      }
    }
  }

  // Tidak ditemukan → APPEND
  sheet.appendRow(row);
  Logger.log('Inserted row in ' + sheetName + ' id=' + (obj.id || '?'));
  return { action: 'inserted', id: obj.id || null };
}


// =============================================================
// DELETE ROW BY ID
// =============================================================

function deleteRow(sheetName, id) {
  if (!id) throw new Error('deleteRow: id is required');

  const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet   = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const headers  = getHeaders(sheet);
  const idColIdx = headers.indexOf('id');
  if (idColIdx < 0) throw new Error('No id column in: ' + sheetName);

  const allData = sheet.getDataRange().getValues();
  // Loop dari bawah agar index tidak bergeser saat delete
  for (let r = allData.length - 1; r >= 1; r--) {
    if (String(allData[r][idColIdx]) === String(id)) {
      sheet.deleteRow(r + 1);
      Logger.log('Deleted row in ' + sheetName + ' id=' + id);
      return { action: 'deleted', id };
    }
  }

  Logger.log('deleteRow: not found in ' + sheetName + ' id=' + id);
  return { action: 'not_found', id };
}


// =============================================================
// CLEAR SHEET (simpan header)
// =============================================================

function clearSheet(sheetName) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const last = sheet.getLastRow();
  if (last > 1) {
    sheet.deleteRows(2, last - 1);
    Logger.log('Cleared sheet: ' + sheetName);
  }
  return { action: 'cleared', sheet: sheetName };
}


// =============================================================
// SETTINGS  (key-value)
// =============================================================

function saveSetting(key, value) {
  if (!key) throw new Error('saveSetting: key is required');

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('settings');
  if (!sheet) throw new Error('Sheet "settings" not found');

  const allData = sheet.getDataRange().getValues();
  for (let r = 1; r < allData.length; r++) {
    if (String(allData[r][0]) === String(key)) {
      sheet.getRange(r + 1, 2).setValue(String(value));
      Logger.log('Updated setting: ' + key + ' = ' + value);
      return { action: 'updated', key };
    }
  }
  sheet.appendRow([key, String(value)]);
  Logger.log('Inserted setting: ' + key + ' = ' + value);
  return { action: 'inserted', key };
}


// =============================================================
// HELPERS
// =============================================================

/** Ambil baris header sheet sebagai array string */
function getHeaders(sheet) {
  const last = sheet.getLastColumn();
  if (last === 0) return [];
  return sheet.getRange(1, 1, 1, last).getValues()[0].map(String);
}

/** Convert sheet rows → array of objects */
function sheetToObjects(sheet) {
  if (!sheet) return [];
  const allData = sheet.getDataRange().getValues();
  if (allData.length < 2) return [];

  const headers = allData[0].map(String);
  return allData.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let val = row[i];
        // Coba parse JSON string
        if (typeof val === 'string' &&
            (val.startsWith('{') || val.startsWith('['))) {
          try { val = JSON.parse(val); } catch(_) {}
        }
        // String kosong → null
        obj[h] = (val === '' ? null : val);
      });
      return obj;
    });
}

/** Convert settings sheet → plain object { key: value } */
function settingsToObject(sheet) {
  if (!sheet) return {};
  const obj  = {};
  const data = sheet.getDataRange().getValues();
  data.slice(1).forEach(row => {
    if (row[0]) obj[String(row[0])] = row[1];
  });
  return obj;
}


// =============================================================
// AUTO-SETUP: buat sheet & header jika belum ada
// =============================================================

function ensureSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const SCHEMAS = {
    subjects:  ['id', 'name', 'icon', 'color'],
    questions: ['id', 'subjectId', 'question', 'optionA', 'optionB', 'optionC', 'optionD',
                'answer', 'explanation', 'imageData'],
    history:   ['id', 'examId', 'studentName', 'studentClass', 'subjectId', 'date',
                'score', 'correct', 'wrong', 'skipped', 'totalQuestions', 'timeTaken',
                'mode', 'resultMode', 'answers', 'questions'],
    settings:  ['key', 'value']
  };

  // Seed data default
  const DEFAULTS = {
    subjects: [
      ['math',       'Matematika',       '🔢', '#FF6B6B'],
      ['science',    'IPA',              '🔬', '#4ECDC4'],
      ['indonesian', 'Bahasa Indonesia', '📚', '#45B7D1']
    ],
    settings: [
      ['pin', '123456']
    ]
  };

  for (const [name, headers] of Object.entries(SCHEMAS)) {
    let sheet = ss.getSheetByName(name);

    // Buat sheet jika belum ada
    if (!sheet) {
      sheet = ss.insertSheet(name);
      Logger.log('Created sheet: ' + name);
    }

    // Pasang header jika sheet masih kosong
    if (sheet.getLastColumn() === 0 || sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      // Bold header
      sheet.getRange(1, 1, 1, headers.length)
           .setFontWeight('bold')
           .setBackground('#4361EE')
           .setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
      Logger.log('Set headers for: ' + name);

      // Isi data default jika ada
      if (DEFAULTS[name]) {
        DEFAULTS[name].forEach(row => sheet.appendRow(row));
        Logger.log('Seeded defaults for: ' + name);
      }
    }
  }
}


// =============================================================
// MANUAL TEST FUNCTION — jalankan dari Apps Script Editor
// =============================================================

/**
 * Klik Run → testSetup() untuk memverifikasi semuanya benar.
 * Lihat hasilnya di View → Logs.
 */
function testSetup() {
  Logger.log('=== TEST SETUP ===');
  ensureSheets();
  const data = getAllData();
  Logger.log('subjects:  ' + data.subjects.length);
  Logger.log('questions: ' + data.questions.length);
  Logger.log('history:   ' + data.history.length);
  Logger.log('settings:  ' + JSON.stringify(data.settings));
  Logger.log('=== OK ===');
}

function testSaveQuestion() {
  const result = saveRow('questions', {
    id:          'test_q_001',
    subjectId:   'math',
    question:    'Berapa hasil 2 + 2?',
    options:     ['A. 2','B. 3','C. 4','D. 5'],
    answer:      'C',
    explanation: 'Dua ditambah dua sama dengan empat.',
    imageData:   null
  });
  Logger.log('testSaveQuestion: ' + JSON.stringify(result));
}

function testDeleteQuestion() {
  const result = deleteRow('questions', 'test_q_001');
  Logger.log('testDeleteQuestion: ' + JSON.stringify(result));
}
