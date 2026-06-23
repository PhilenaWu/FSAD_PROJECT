Estate Incident Management System — Frontend

React client for the Estate Incident Management System. Residents report estate defects and track their status; managers triage incidents, view analytics dashboards, and send notifications — with real-time updates over Socket.IO. Built with Vite and deployed on Vercel.

Features:
Auth — login with JWT held in memory using React.
Resident flows — submit a report with photo + location, track "My Reports", read notifications, leave satisfaction ratings.
Manager flows — incident queue with filtering, incident detail + status updates with audit log, analytics dashboard, notification composer with read receipts, weekly report archive.
Real-time — live status changes via Socket.IO rooms (manager, per-block, per-incident).
Analytics — Chart.js heatmap, trend lines, and SLA-compliance gauge.
CV overlay — bounding-box overlay rendered on uploaded photos from Roboflow detections.


Tech stack:
ConcernChoiceFrameworkReact 18Build toolViteHTTPaxiosReal-timeSocket.IO clientChartsChart.jsDeployVercel


Project structure:

frontend/
├── src/
│   ├── pages/             # Login, Dashboard, IncidentList, IncidentDetail,
│   │                      # ReportIssue, MyReports, Notifications, ReportsArchive
│   ├── components/
│   │   ├── auth/          # LoginForm
│   │   ├── incidents/     # IncidentCard, IncidentForm, StatusBadge, AuditLog
│   │   ├── analytics/     # HeatmapChart, TrendLineChart, SlaGauge, PriorityQueue, AIAlertCard
│   │   ├── cv/            # BoundingBoxOverlay
│   │   ├── notifications/ # NotificationComposer, ReadReceiptBadge
│   │   └── common/        # Header, Sidebar, Toast, Modal, LoadingSpinner, EmptyState
│   ├── context/          # AuthContext (JWT + role), SocketContext (connection + rooms)
│   ├── hooks/            # useAuth, useSocket, useIncidents, useAnalytics
│   ├── services/         # api (axios), authService, incidentService, analyticsService, notificationService
│   ├── utils/            # csvDownload, dateHelpers
│   └── App.jsx           # Router + Auth/Socket providers
├── public/
├── vite.config.js
├── .env.example
└── package.json


Getting started

Prerequisites:
- Node.js 20+
- A running backend (local or deployed) — see the backend repo


Install:
- bashnpm install

Environment:
- bashcp .env.example .env
- VariableDescriptionVITE_API_URLBase URL of the backend API (e.g. http://localhost:PORT locally, or your Render URL)
- VITE_API_URL is read by src/services/api.js as the axios baseURL and is also used to open the Socket.IO connection.

Run:
bashnpm run dev       # start the Vite dev server
npm run build     # production build
npm run preview   # preview the production build locally


How it talks to the backend:
REST — all API calls go through a shared axios instance (src/services/api.js) that sets baseURL from VITE_API_URL and attaches the JWT Authorization header from AuthContext.
Real-time — SocketContext opens a Socket.IO connection and joins rooms based on the user's role and block, so the UI updates live when incidents change.
Auth — AuthContext stores the token and user role in memory only. The protected-route wrapper in App.jsx redirects to /login when no token is present.


Key pages:
PageRolePurposeLoginPageallAuthenticationReportIssuePageresidentSubmit a new incident (photo + location)MyReportsPageresidentTrack the status of submitted reportsNotificationsPage (read)residentView block notificationsIncidentListPagemanagerTriage queue with filtersIncidentDetailPagemanagerDetail view, status updates, audit logDashboardPagemanagerAnalytics + AI alert cardsNotificationsPage (compose)managerSend block-scoped notificationsReportsArchivePagemanagerBrowse weekly PDF reports


Deployment (Vercel):
Import this repo into Vercel.
Framework preset: Vite.
Set VITE_API_URL to your deployed backend (Render) URL.
Deploy. Make sure the backend's FRONTEND_URL env var is set to your Vercel URL so CORS and Socket.IO accept the origin.


Notes:
The JWT is intentionally not persisted to localStorage or cookies — refreshing the page requires re-authentication. This is a deliberate security choice.
CSV export is generated client-side (utils/csvDownload.js).
