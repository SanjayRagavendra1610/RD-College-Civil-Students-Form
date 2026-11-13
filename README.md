# RDCCPS School Student Form — Netlify + Google Sheets

The student registration form is in index.html. Netlify Functions validate submissions and write them to the private School Students worksheet in the configured spreadsheet. The form displays its thank-you receipt only after Google Sheets confirms the save.

Default spreadsheet:
Configured in Netlify through the `GOOGLE_SHEET_ID` environment variable.

## Form fields

Student name, school, Tamil Nadu district, class/grade, parent or guardian name, phone, optional email, course/area of interest, optional message, and a Yes/No answer for Civil Service Exam Preparation.

The district dropdown and server validation use the same 38 Tamil Nadu districts.

## Google Sheets and Netlify setup

1. In Google Cloud Console, enable the Google Sheets API and create a service account with a JSON key.
2. Share the configured target spreadsheet with the service account's client_email as Editor. Keep the spreadsheet private.
3. In the Netlify site's environment variables, set:
   - GOOGLE_SHEET_ID = the ID of the private target spreadsheet
   - GOOGLE_SERVICE_ACCOUNT_JSON = the full service-account JSON as a single-line JSON value
   - ALLOWED_ORIGIN = the production origin of the Netlify site
   - ADMIN_ACCESS_KEY = a strong organizer-only key for Admin Responses
4. Ensure the variables are available to Netlify Functions, then redeploy the site.

Never place the service-account JSON or admin key in HTML, JavaScript, Git, or chat.

## Student worksheet and older columns

On the first submission or admin refresh, the Functions create the School Students worksheet and its headers if missing. New registrations are stored there, separate from historical consultancy rows.

The migration removes only these exact obsolete columns from the previous first worksheet:
- 8. Contact Number for Brochure Printing
- 10. Attendee Names (one per line)
- 11. Attendee Food Options (same order)

Other legacy columns and historical rows are preserved.

The student worksheet columns are: Timestamp, Student Name, School Name, District, Class / Grade, Parent / Guardian Name, Parent / Guardian Phone, Parent / Guardian Email, Course / Area of Interest, Message, Civil Service Exam Preparation, and Record ID.

## Run locally and deploy

npm install
npm run dev

Netlify CLI usually serves the site at http://localhost:8888. For local runs, set ALLOWED_ORIGIN=http://localhost:8888 in an uncommitted local .env file.

After linking the existing Netlify site:

npx netlify login
npx netlify link
npx netlify deploy --build --prod

The repository can also deploy through the Git repository connected to the Netlify site. The publish directory is the repository root.

## Admin responses

- admin-auth validates the organizer access key on the server and returns a short-lived session token.
- admin-leads reads and deletes entries in School Students; the admin page refreshes from Sheets every 15 seconds.
- Share the sheet with the service account as Editor. Do not make the sheet public.
- Do not reuse a public phone number or other public value as the admin key.
- The form only reports success after the Sheets API confirms the write.
