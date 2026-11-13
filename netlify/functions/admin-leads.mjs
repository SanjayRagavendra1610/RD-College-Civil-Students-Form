import { google } from "googleapis";
import {
  allowedOrigin,
  hasAdminSession,
  isAllowedOrigin,
  optionsResponse,
  response,
} from "./_shared/admin-auth.mjs";
import { ensureLeadSheetSchema } from "./_shared/lead-sheet-schema.mjs";

function sheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_SHEET_ID) {
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
  const firstSheet = spreadsheet.data.sheets?.[0]?.properties;
  if (!firstSheet?.title) throw new Error("Spreadsheet does not contain a worksheet.");
  const sheetTitle = await ensureLeadSheetSchema(sheets, spreadsheetId, firstSheet);
  const valuesResult = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A2:M`,
  });
  return { firstSheet, sheetTitle, values: valuesResult.data.values || [] };
}

function toEntry(row, index) {
  const submittedAt = String(row[0] || "");
  const date = new Date(submittedAt);
  const attendeeNames = String(row[11] || "").split("\n");
  const attendeeFoods = String(row[12] || "").split("\n");
  const attendees = attendeeNames
    .map((name, attendeeIndex) => ({ name: name.trim(), food: String(attendeeFoods[attendeeIndex] || "").trim() }))
    .filter((attendee) => attendee.name);
  return {
    id: String(row[10] || `sheet-row-${index + 2}`),
    submittedAt,
    submittedReadable: Number.isNaN(date.getTime()) ? submittedAt : date.toLocaleString("en-IN"),
    consultancyName: String(row[1] || ""),
    consultantName: String(row[2] || ""),
    consultancyAddress: String(row[3] || ""),
    contactNumber: String(row[4] || ""),
    foodOptions: String(row[5] || ""),
    consultancyRequirements: String(row[6] || ""),
    requiredBrochure: String(row[7] || ""),
    brochureContactNumber: String(row[8] || ""),
    personsAttended: String(row[9] || "1"),
    attendees,
    attendeeDetails: attendees.map((attendee, attendeeIndex) => `${attendeeIndex + 1}. ${attendee.name} - ${attendee.food}`).join("\n"),
    targetAccount: "rdccpscollege@gmail.com",
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  if (event.httpMethod === "OPTIONS") return optionsResponse(event, "GET, DELETE");
  if (!["GET", "DELETE"].includes(event.httpMethod)) {
    return response(405, { success: false, error: "Method not allowed." });
  }
  if (!isAllowedOrigin(event)) return response(403, { success: false, error: "Origin not allowed." });
  if (!hasAdminSession(event)) return response(401, { success: false, error: "Admin sign-in required." }, origin);

  try {
    const sheets = sheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const { firstSheet, sheetTitle, values } = await getSheetRows(sheets, spreadsheetId);

    if (event.httpMethod === "DELETE") {
      const payload = JSON.parse(event.body || "{}");
      const ids = new Set((Array.isArray(payload.ids) ? payload.ids : []).map(String));
      const deleteAll = payload.deleteAll === true;
      if (!deleteAll && ids.size === 0) {
        return response(400, { success: false, error: "Choose at least one response to delete." }, origin);
      }
      const matchingIndexes = values
        .map((row, index) => ({ row, index }))
        .filter(({ row, index }) => deleteAll || ids.has(String(row[10] || `sheet-row-${index + 2}`)))
        .map(({ index }) => index + 1)
        .sort((a, b) => b - a);

      if (matchingIndexes.length) {
        const requests = matchingIndexes.map((startIndex) => ({
          deleteDimension: {
            range: {
              sheetId: firstSheet.sheetId,
              dimension: "ROWS",
              startIndex,
              endIndex: startIndex + 1,
            },
          },
        }));
        await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      }
      return response(200, { success: true, deletedCount: matchingIndexes.length }, origin || allowedOrigin());
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
