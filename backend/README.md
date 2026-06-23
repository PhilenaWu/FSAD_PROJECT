Estate Incident Management System — Backend

REST API and real-time server for the Estate Incident Management System. Built with Node.js, Express, and Socket.IO; backed by Supabase (PostgreSQL) and integrated with Cloudinary, Roboflow, and OpenAI. Deployed on Render.


Features:
Auth — register / login / logout with JWT (30-minute sliding expiry) and bcrypt-hashed passwords.
Incidents — full CRUD: create (with photo upload), list/filter, view, update status, close, rate.
Real-time — Socket.IO server with manager, per-block, and per-incident rooms for live updates.
Computer vision — sends uploaded photos to Roboflow; auto-creates tickets above a 70% confidence threshold.
AI engine — OpenAI categorises incidents, generates risk alerts on recurring failures, and summarises reports.
Analytics — issues-by-block heatmap, trends, and SLA-compliance endpoints.
Reports — pdfkit weekly PDF generation, stored on Cloudinary, emailed via Nodemailer.
Notifications — block-scoped notifications with scheduled dispatch and read receipts.
Scheduled jobs — cron-protected endpoints for nightly AI recommendations and weekly reports.


Tech stack:
ConcernLibraryRuntimeNode.js 20FrameworkExpress 4Real-timeSocket.IO 4DatabasePostgreSQL (Supabase) via pgAuthjsonwebtoken, bcryptUploadsmulterImage / PDF storageCloudinary SDKCVRoboflow Inference APIAIOpenAI API (gpt-4o-mini)PDFpdfkitEmailnodemailerValidationjoi / zodRate limitingexpress-rate-limit


Project structure:
backend/
├── src/
│   ├── routes/            # auth, incidents, analytics, recommendations,
│   │                      # reports, notifications, cv
│   ├── controllers/       # request handlers per resource
│   ├── services/          # openai, cloudinary, roboflow, pdf, email, socket
│   ├── middleware/        # auth, cronGuard, rateLimiter, errorHandler, validate
│   ├── models/            # DB query layer per table
│   ├── config/            # db, cloudinary, socket, env validation
│   ├── utils/             # notificationDispatcher, jwtHelpers, velocity, sla, csv
│   └── app.js             # Express app, middleware chain, route mounting
├── migrations/            # 001–010 SQL files (run in order)
├── tests/                 # unit + integration
├── server.js              # HTTP server + Socket.IO attach + listen
├── .env.example
└── package.json


Getting started

Prerequisites: 
- Node.js 20+
- A Supabase project (PostgreSQL)
- Accounts/keys for Cloudinary, Roboflow, OpenAI, and an SMTP provider


Install:
bashnpm install

Environment:
bashcp .env.example .env


VariableDescriptionDATABASE_URLSupabase PostgreSQL connection stringJWT_SECRETSecret for signing JWTsFRONTEND_URLAllowed origin for CORS + Socket.IONODE_ENVdevelopment or productionCLOUDINARY_CLOUD_NAMECloudinary cloud nameCLOUDINARY_API_KEYCloudinary API keyCLOUDINARY_API_SECRETCloudinary API secretOPENAI_API_KEYOpenAI API keyROBOFLOW_API_KEYRoboflow API keyCRON_SECRETBearer token guarding scheduled endpointsSMTP_HOSTSMTP server hostSMTP_USERSMTP usernameSMTP_PASSSMTP password / app password

Database:
Run the 10 migration files in migrations/ in order (001 → 010) against your Supabase database — e.g. paste each into the Supabase SQL editor, or apply with your preferred migration runner.

Run:
- bashnpm run dev     # local development
- npm start       # production (node server.js)
- npm test        # run the test suite

The server attaches Socket.IO to the same HTTP server and listens on the configured port.


API reference:
All authenticated routes require Authorization: Bearer <JWT>. All scheduled routes require Authorization: Bearer <CRON_SECRET>. Responses are JSON.

Auth:
MethodPathAuthDescriptionPOST/api/auth/register—Create a resident accountPOST/api/auth/login—Authenticate, returns JWTPOST/api/auth/logoutuserEnd session (client drops token)

Incidents:
MethodPathAuthDescriptionPOST/api/incidentsresidentCreate report (multipart, optional photo)GET/api/incidentsmanagerList all (filterable), sorted by AI priorityGET/api/incidents/myresidentList the caller's reportsGET/api/incidents/:iduserGet one incidentPATCH/api/incidents/:id/statusmanagerUpdate status / assignmentPOST/api/incidents/:id/closemanagerClose an incident

Analytics:
MethodPathAuthDescriptionGET/api/analytics/issues-by-blockmanagerHeatmap dataGET/api/analytics/trendsmanagerTrend linesGET/api/analytics/sla-compliancemanagerSLA gauge data

Recommendations (AI):
MethodPathAuthDescriptionGET/api/recommendations/runCRON_SECRETDrain ai_jobs queue, run velocity scan, generate alerts

Reports:
MethodPathAuthDescriptionGET/api/reports/generateCRON_SECRETGenerate + store + email weekly PDFPOST/api/reports/generate-manualmanagerTrigger a report manually

Notifications:
MethodPathAuthDescriptionPOST/api/notificationsmanagerSend / schedule a block-scoped notificationGET/api/notifications/:id/receiptsmanagerRead-receipt countsPATCH/api/notifications/:id/readresidentMark a notification read

Scheduled notification dispatch is not an HTTP endpoint — it runs in-process via notificationDispatcher.js on a 60-second setInterval loop.



Computer vision:
MethodPathAuthDescriptionPOST/api/cv/detectinternalRun Roboflow detection on an imageGET/api/cv/batch-scanCRON_SECRETReprocess failed images from retry_queue

Health:
MethodPathAuthDescriptionGET/health—Liveness check (used by UptimeRobot)


Error format:
All errors return a consistent shape:

json{ "code": "ERROR_CODE", "message": "Human-readable message" }

CodeHTTPMeaningINVALID_CREDENTIALS401Wrong email or passwordUNAUTHORIZED401Missing or expired JWTFORBIDDEN403Role lacks accessVALIDATION_ERROR400Request body failed validationNOT_FOUND404Resource does not existDUPLICATE_SUBMISSION409Duplicate record detectedALREADY_RATED409Satisfaction rating already submittedEMAIL_ALREADY_EXISTS400Registration email conflictSERVER_ERROR500Unhandled internal error


Database:
Ten PostgreSQL tables: users, incidents, incident_history, cv_detections, ai_predictions, ai_jobs, notifications, notification_recipients, reports, retry_queue. See the migration files and the High-Level Design doc for the full schema and relationships.


Security:
bcrypt password hashing (12 salt rounds).
JWT auth with 30-minute sliding expiry.
requireRole('manager') middleware on manager-only routes.
cronGuard validates CRON_SECRET on scheduled endpoints.
CORS restricted to FRONTEND_URL (both Express and Socket.IO).
express-rate-limit: 100 requests / 15 min per IP on auth routes.
Request bodies validated with joi/zod before reaching controllers.


Deployment (Render):
Create a Render Web Service from this repo.
Set the start command to node server.js.
Add all environment variables listed above.
Set FRONTEND_URL to your deployed Vercel URL.
Point an UptimeRobot HTTP(s) monitor at /health (5-minute interval) to avoid free-tier cold starts.


Scheduled jobs:
Configure GitHub Actions workflows (with CRON_SECRET and the Render backend URL as secrets) to call:


/api/recommendations/run — nightly
/api/reports/generate — weekly
