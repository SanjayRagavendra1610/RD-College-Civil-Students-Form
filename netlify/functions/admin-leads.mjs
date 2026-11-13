import { google } from "googleapis";
import {
  allowedOrigin,
  hasAdminSession,
  isAllowedOrigin,
  optionsResponse,
  response,
} from "./_shared/admin-auth.mjs";
import { ensureStudentSheet, SPREADSHEET_ID } from "./_shared/lead-sheet-schema.mjs";

function sheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Google Sheets is not configured.");
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getSheetRows(sheets, spreadsheetId) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,gridProperties)",
  });
  const worksheetProperties = (spreadsheet.data.sheets || []).map((sheet) => sheet.properties).filter(Boolean);
  const studentSheet = await ensureStudentSheet(sheets, spreadsheetId, worksheetProperties);
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${studentSheet.title.replace(/'/g, "''")}'!A2:L`,
  });
  return { studentSheet, values: result.data.values || [] };
}

function toEntry(row, index) {
  const submittedAt = String(row[0] || "");
  const date = new Date(submittedAt);
  return {
    id: String(row[11] || `sheet-row-${index + 2}`),
    submittedAt,
    submittedReadable: Number.isNaN(date.getTime()) ? submittedAt : date.toLocaleString("en-IN"),
    studentName: String(row[1] || ""),
    schoolName: String(row[2] || ""),
    district: String(row[3] || ""),
    className: String(row[4] || ""),
    parentName: String(row[5] || ""),
    parentPhone: String(row[6] || ""),
    parentEmail: String(row[7] || ""),
    interest: String(row[8] || ""),
    message: String(row[9] || ""),
    civilServiceInterested: String(row[10] || ""),
    targetAccount: "rdccpscollege@gmail.com",
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  if (event.httpMethod === "OPTIONS") return optionsResponse(event, "GET, DELETE");
  if (!["GET", "DELETE"].includes(event.httpMethod)) return response(405, { success: false, error: "Method not allowed." });
  if (!isAllowedOrigin(event)) return response(403, { success: false, error: "Origin not allowed." });
  if (!hasAdminSession(event)) return response(401, { success: false, error: "Admin sign-in required." }, origin);

  try {
    const sheets = sheetsClient();
    const spreadsheetId = SPREADSHEET_ID;
    const { studentSheet, values } = await getSheetRows(sheets, spreadsheetId);

    if (event.httpMethod === "DELETE") {
      const payload = JSON.parse(event.body || "{}");
      const ids = new Set((Array.isArray(payload.ids) ? payload.ids : []).map(String));
      const deleteAll = payload.deleteAll === true;
      if (!deleteAll && ids.size === 0) {
        return response(400, { success: false, error: "Choose at least one response to delete." }, origin);
      }
      const indexes = values.map((row, index) => ({ row, index }))
        .filter(({ row, index }) => deleteAll || ids.has(String(row[11] || `sheet-row-${index + 2}`)))
        .map(({ index }) => index + 1)
        .sort((a, b) => b - a);
      if (indexes.length) {
        const requests = indexes.map((startIndex) => ({
          deleteDimension: {
            range: { sheetId: studentSheet.sheetId, dimension: "ROWS", startIndex, endIndex: startIndex + 1 },
          },
        }));
        await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      }
      return response(200, { success: true, deletedCount: indexes.length }, origin || allowedOrigin());
    }

    const rows = values.map(toEntry).sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
    return response(200, {
      success: true,
      rows,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
    }, origin || allowedOrigin());
  } catch (error) {
    console.error("admin-leads failed:", error?.message || error);
    return response(500, { success: false, error: "Could not load saved responses from Google Sheets." }, origin);
  }
}
