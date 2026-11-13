import { google } from "googleapis";
import { ensureLeadSheetSchema, LEAD_SHEET_HEADERS } from "./_shared/lead-sheet-schema.mjs";

const REQUIRED_FIELDS = [
  "consultancyName",
  "consultantName",
  "consultancyAddress",
  "contactNumber",
  "consultancyRequirements",
  "requiredBrochure",
];

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
  const allowedOrigin = process.env.ALLOWED_ORIGIN || new URL(process.env.URL || "http://localhost:8888").origin;

  if (event.httpMethod === "OPTIONS") {
    if (origin && origin !== allowedOrigin) return json(403, { success: false, error: "Origin not allowed." });
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
    return json(405, { success: false, error: "Method not allowed." }, origin === allowedOrigin ? origin : "");
  }
  if (origin && origin !== allowedOrigin) {
    return json(403, { success: false, error: "Origin not allowed." });
  }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_SHEET_ID) {
      console.error("Missing Google Sheets environment variables.");
      return json(500, { success: false, error: "Server is not configured for Google Sheets." }, origin);
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

    const persons = Number(payload.personsAttended || 1);
    if (!Number.isInteger(persons) || persons < 1 || persons > 10000) {
      return json(400, { success: false, error: "Invalid number of persons." }, origin);
    }
    const attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
    if (attendees.length && attendees.length !== persons) {
      return json(400, { success: false, error: "Attendee count does not match the number of persons." }, origin);
    }
    for (const attendee of attendees) {
      if (!attendee || typeof attendee.name !== "string" || !attendee.name.trim() || attendee.name.length > 500) {
        return json(400, { success: false, error: "Each attendee must have a valid name." }, origin);
      }
      if (!["Veg", "Non Veg"].includes(attendee.food)) {
        return json(400, { success: false, error: "Each attendee must have a valid food option." }, origin);
      }
    }
    const attendeeNames = attendees.map((attendee) => attendee.name.trim()).join("\n");
    const attendeeFoods = attendees.map((attendee) => attendee.food).join("\n");
    if (attendeeNames.length > 45000 || attendeeFoods.length > 45000) {
      return json(400, { success: false, error: "Attendee details are too long to save. Reduce the number or length of names." }, origin);
    }

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(sheetId,title,gridProperties)",
    });
    const firstSheet = spreadsheet.data.sheets?.[0]?.properties;
    if (!firstSheet?.title) throw new Error("Spreadsheet does not contain a worksheet.");

    const sheetTitle = await ensureLeadSheetSchema(sheets, spreadsheetId, firstSheet);
    const range = `'${sheetTitle}'!A:M`;

    // Avoid appending the same submission ID twice if a client retries.
    const recordId = String(payload.id || "");
    if (!recordId || recordId.length > 150) {
      return json(400, { success: false, error: "Missing or invalid submission ID." }, origin);
    }
    const lastRows = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetTitle}'!K2:K`,
    });
    const alreadyExists = (lastRows.data.values || []).some((row) => String(row[0] || "") === recordId);
    if (alreadyExists) {
      return json(200, { success: true, duplicate: true }, origin);
    }

    const timestamp = payload.submittedAt || new Date().toISOString();
    const foodOptions = payload.foodOptions || [...new Set(attendees.map((attendee) => attendee.food))].join(", ");
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          timestamp,
          payload.consultancyName.trim(),
          payload.consultantName.trim(),
          payload.consultancyAddress.trim(),
          payload.contactNumber.trim(),
          foodOptions,
          payload.consultancyRequirements.trim(),
          payload.requiredBrochure.trim(),
          String(payload.brochureContactNumber || "").trim(),
          String(persons),
          recordId,
          attendeeNames,
          attendeeFoods,
        ]],
      },
    });

    return json(200, { success: true }, origin);
  } catch (error) {
    console.error("submit-lead failed:", error?.message || error);
    return json(500, { success: false, error: "Could not save to Google Sheets. Please try again." }, origin);
  }
}
