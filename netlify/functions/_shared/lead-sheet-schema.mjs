export const STUDENT_SHEET_TITLE = "School Students";

export const STUDENT_SHEET_HEADERS = [
  "Timestamp",
  "Student Name",
  "School Name",
  "District",
  "Class / Grade",
  "Parent / Guardian Name",
  "Parent / Guardian Phone",
  "Parent / Guardian Email",
  "Course / Area of Interest",
  "Message",
  "Civil Service Exam Preparation",
  "Record ID",
];

const REMOVED_LEGACY_HEADERS = new Set([
  "8. Contact Number for Brochure Printing",
  "10. Attendee Names (one per line)",
  "11. Attendee Food Options (same order)",
]);

export const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "";

function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

async function removeRequestedLegacyColumns(sheets, spreadsheetId, legacySheet) {
  if (!legacySheet?.title || legacySheet.title === STUDENT_SHEET_TITLE) return;
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetTitle(legacySheet.title)}!A1:AZ1`,
  });
  const headers = result.data.values?.[0] || [];
  const columns = headers
    .map((header, index) => REMOVED_LEGACY_HEADERS.has(String(header || "").trim()) ? index : -1)
    .filter((index) => index >= 0)
    .sort((a, b) => b - a);

  if (!columns.length) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: columns.map((columnIndex) => ({
        deleteDimension: {
          range: {
            sheetId: legacySheet.sheetId,
            dimension: "COLUMNS",
            startIndex: columnIndex,
            endIndex: columnIndex + 1,
          },
        },
      })),
    },
  });
}

async function getWorksheetProperties(sheets, spreadsheetId) {
  const result = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,gridProperties)",
  });
  return (result.data.sheets || []).map((sheet) => sheet.properties).filter(Boolean);
}

export async function ensureStudentSheet(sheets, spreadsheetId, worksheetProperties = []) {
  const worksheets = Array.isArray(worksheetProperties)
    ? worksheetProperties
    : worksheetProperties?.title
      ? [worksheetProperties]
      : await getWorksheetProperties(sheets, spreadsheetId);

  const legacySheet = worksheets.find((sheet) => sheet.title !== STUDENT_SHEET_TITLE);
  await removeRequestedLegacyColumns(sheets, spreadsheetId, legacySheet);

  let studentSheet = worksheets.find((sheet) => sheet.title === STUDENT_SHEET_TITLE);
  if (!studentSheet) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: STUDENT_SHEET_TITLE,
              gridProperties: { rowCount: 1000, columnCount: STUDENT_SHEET_HEADERS.length, frozenRowCount: 1 },
            },
          },
        }],
      },
    });
    studentSheet = created.data.replies?.[0]?.addSheet?.properties;
    if (!studentSheet?.sheetId) {
      const refreshed = await getWorksheetProperties(sheets, spreadsheetId);
      studentSheet = refreshed.find((sheet) => sheet.title === STUDENT_SHEET_TITLE);
    }
  }
  if (!studentSheet?.sheetId) throw new Error(`Could not create the "${STUDENT_SHEET_TITLE}" worksheet.`);

  const title = quoteSheetTitle(STUDENT_SHEET_TITLE);
  const headerResult = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!A1:L1`,
  });
  const currentHeaders = headerResult.data.values?.[0] || [];

  if (!currentHeaders.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1:L1`,
      valueInputOption: "RAW",
      requestBody: { values: [STUDENT_SHEET_HEADERS] },
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: studentSheet.sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.05, green: 0.16, blue: 0.30 },
                  textFormat: { foregroundColor: { red: 0.91, green: 0.84, blue: 0.53 }, bold: true },
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat)",
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId: studentSheet.sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
        ],
      },
    });
  } else if (STUDENT_SHEET_HEADERS.some((header, index) => currentHeaders[index] !== header)) {
    throw new Error(`The "${STUDENT_SHEET_TITLE}" worksheet has unexpected headers. Correct its first row before accepting submissions.`);
  }
  return studentSheet;
}
