import {
  allowedOrigin,
  checkAdminCredentials,
  createAdminSession,
  isAllowedOrigin,
  optionsResponse,
  response,
} from "./_shared/admin-auth.mjs";

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  if (event.httpMethod === "OPTIONS") return optionsResponse(event, "POST");
  if (event.httpMethod !== "POST") return response(405, { success: false, error: "Method not allowed." });
  if (!isAllowedOrigin(event)) return response(403, { success: false, error: "Origin not allowed." });
  if (!process.env.ADMIN_ACCESS_KEY) {
    return response(503, { success: false, error: "Admin sign-in is not configured yet." }, origin);
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    if (!checkAdminCredentials(payload.email, payload.password)) {
      return response(401, { success: false, error: "Invalid admin email or access key." }, origin);
    }
    const token = createAdminSession(String(payload.email).trim().toLowerCase());
    return response(200, { success: true, token }, origin || allowedOrigin());
  } catch (error) {
    console.error("admin-auth failed:", error?.message || error);
    return response(500, { success: false, error: "Could not sign in to the admin portal." }, origin);
  }
}
