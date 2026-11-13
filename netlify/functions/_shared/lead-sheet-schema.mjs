export const LEAD_SHEET_HEADERS = [
  "Timestamp",
  "1. Consultancy Name",
  "2. Consultant Name",
  "3. Consultancy Address",
  "4. Contact Number",
  "5. Food Options",
  "6. Requirements",
  "7. Required Brochure",
  "8. Contact Number for Brochure Printing",
  "9. Persons Attended",
  "Record ID",
  "10. Attendee Names (one per line)",
  "11. Attendee Food Options (same order)",
];

export async function ensureLeadSheetSchema(sheets, spreadsheetId, firstSheet) {
  const sheetTitle = firstSheet.title.replace(/'/g, "''");
  const headerResult = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A1:M1`,
  });
  const currentHeaders = headerResult.data.values?.[0] || [];

  if (!currentHeaders.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetTitle}'!A1:M1`,
      valueInputOption: "RAW",
      requestBody: { values: [LEAD_SHEET_HEADERS] },
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          repeatCell: {
            range: { sheetId: firstSheet.sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.05, green: 0.16, blue: 0.30 },
                textFormat: { foregroundColor: { red: 0.91, green: 0.84, blue: 0.53 }, bold: true },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        }],
      },
    });
    return sheetTitle;
  }

  if (currentHeaders[7] === LEAD_SHEET_HEADERS[7] && currentHeaders[8] !== LEAD_SHEET_HEADERS[8]) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: { sheetId: firstSheet.sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 },
              inheritFromBefore: true,
            },
          },
          {
            updateCells: {
              range: { sheetId: firstSheet.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 8, endColumnIndex: 13 },
              rows: [{
                values: LEAD_SHEET_HEADERS.slice(8).map((header) => ({ userEnteredValue: { stringValue: header } })),
              }],
              fields: "userEnteredValue",
            },
          },
        ],
      },
    });
    return sheetTitle;
  }

  for (let columnIndex = 0; columnIndex < LEAD_SHEET_HEADERS.length; columnIndex += 1) {
    if (!currentHeaders[columnIndex]) {
      const column = String.fromCharCode(65 + columnIndex);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetTitle}'!${column}1`,
        valueInputOption: "RAW",
        requestBody: { values: [[LEAD_SHEET_HEADERS[columnIndex]]] },
      });
    }
  }
  return sheetTitle;
}

// Target spreadsheet for all registrations (not a secret; env var overrides it).
export const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1vVo8OLnLEJOQDLSQgEkBHQl2OmowwpeLSmpkvbcnJhs";
