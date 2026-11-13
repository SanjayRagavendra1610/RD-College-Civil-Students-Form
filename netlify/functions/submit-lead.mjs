import { google } from "googleapis";
import { ensureStudentSheet, SPREADSHEET_ID, STUDENT_SHEET_HEADERS } from "./_shared/lead-sheet-schema.mjs";
import { allowedOrigins } from "./_shared/admin-auth.mjs";

const REQUIRED_FIELDS = [
  "studentName",
  "schoolName",
  "district",
  "className",
  "parentName",
  "parentPhone",
  "interest",
  "civilServiceInterested",
];

const TAMIL_NADU_DISTRICTS = new Set([
  "Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri",
  "Dindigul", "Erode", "Kallakurichi", "Kancheepuram", "Kanniyakumari", "Karur",
  "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Perambalur",
  "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi",
  "Thanjavur", "Theni", "The Nilgiris", "Thoothukudi", "Tiruchirappalli", "Tirunelveli",
  "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore",
  "Viluppuram", "Virudhunagar",
]);

function json(statusCode, body, origin = "") {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const origins = allowedOrigins();
  const allowedOrigin = origin && origins.has(origin) ? origin : [...origins][0];

  if (event.httpMethod === "OPTIONS") {
    if (origin && !origins.has(origin)) return json(403, { success: false, error: "Origin not allowed." });
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
      body: "",
    };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { success: false, error: "Method not allowed." }, origin && origins.has(origin) ? origin : "");
  }
  if (origin && !origins.has(origin)) return json(403, { success: false, error: "Origin not allowed." });

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !SPREADSHEET_ID) {
      console.error("Missing Google Sheets service account credentials or spreadsheet ID.");
      return json(503, {
        success: false,
        code: "SHEETS_NOT_CONFIGURED",
        error: "Registration is temporarily unavailable. Please contact the organizer to configure Google Sheets access.",
      }, origin);
    }

    const payload = JSON.parse(event.body || "{}");
    for (const field of REQUIRED_FIELDS) {
      if (typeof payload[field] !== "string" || !payload[field].trim()) {
        return json(400, { success: false, error: `Missing or invalid field: ${field}` }, origin);
      }
      if (payload[field].length > 5000) {
        return json(400, { success: false, error: `Field is too long: ${field}` }, origin);
      }
    }
    if (!TAMIL_NADU_DISTRICTS.has(payload.district.trim())) {
      return json(400, { success: false, error: "Select a valid Tamil Nadu district." }, origin);
    }
    if (!["Yes", "No"].includes(payload.civilServiceInterested)) {
      return json(400, { success: false, error: "Choose Yes or No for Civil Service Exam Preparation." }, origin);
    }

    const parentEmail = String(payload.parentEmail || "").trim();
    if (parentEmail.length > 320 || (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail))) {
      return json(400, { success: false, error: "Enter a valid parent email address." }, origin);
    }
    if (typeof payload.parentEmail !== "undefined" && typeof payload.parentEmail !== "string") {
      return json(400, { success: false, error: "Invalid parent email." }, origin);
    }
    for (const field of ["message"]) {
      if (typeof payload[field] !== "undefined" && typeof payload[field] !== "string") {
        return json(400, { success: false, error: `Invalid field: ${field}` }, origin);
      }
      if (String(payload[field] || "").length > 5000) {
        return json(400, { success: false, error: "Message is too long." }, origin);
      }
    }

    const recordId = String(payload.id || "");
    if (!recordId || recordId.length > 150) {
      return json(400, { success: false, error: "Missing or invalid submission ID." }, origin);
    }

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = SPREADSHEET_ID;
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(sheetId,title,gridProperties)",
    });
    const worksheetProperties = (spreadsheet.data.sheets || []).map((sheet) => sheet.properties).filter(Boolean);
    const studentSheet = await ensureStudentSheet(sheets, spreadsheetId, worksheetProperties);
    const sheetTitle = studentSheet.title.replace(/'/g, "''");

    const existingIds = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetTitle}'!L2:L`,
    });
    if ((existingIds.data.values || []).some((row) => String(row[0] || "") === recordId)) {
      return json(200, { success: true, duplicate: true }, origin);
    }

    const values = [
      payload.submittedAt || new Date().toISOString(),
      payload.studentName.trim(),
      payload.schoolName.trim(),
      payload.district.trim(),
      payload.className.trim(),
      payload.parentName.trim(),
      payload.parentPhone.trim(),
      parentEmail,
      payload.interest.trim(),
      String(payload.message || "").trim(),
      payload.civilServiceInterested,
      recordId,
    ];
    if (values.length !== STUDENT_SHEET_HEADERS.length) throw new Error("Student row does not match sheet schema.");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetTitle}'!A:L`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [values] },
    });
    return json(200, { success: true }, origin);
  } catch (error) {
    // Keep permission details out of logs and return an actionable public message.
    console.error("submit-lead failed", { status: error?.response?.status || 500 });
    const googleError = error?.response?.data?.error;
    if (error?.response?.status === 403 && googleError?.message === "The caller does not have permission") {
      return json(503, {
        success: false,
        code: "SHEET_ACCESS_DENIED",
        error: "Registration is temporarily unavailable because Google Sheet access has not been granted. Please contact the organizer.",
      }, origin);
    }
    return json(500, { success: false, error: "Could not save to Google Sheets. Please try again." }, origin);
  }
}
