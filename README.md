# Hospital Management System (HMS)

A multi-tenant hospital operations web application for managing patients,
clinical records, staff memberships, and doctor appointments. The app also
supports queuing appointment requests in the browser during temporary network
outages and safely retrying them when connectivity returns.

> **Development prototype — not for real patient data.** This repository is
> not production-ready and does not claim HIPAA, GDPR, or other regulatory
> compliance. Before any real-data use, complete a formal security, privacy,
> clinical-safety, compliance, deployment, audit, backup, and recovery review.

## Highlights

- Separate hospital workspaces with tenant-scoped data and account memberships.
- Role-based access for administrators, doctors, receptionists, and staff.
- Patient registration, directory, and details.
- Clinical records for diagnoses, notes, medications, allergies, and history.
- Doctor availability and appointment booking, updates, rescheduling,
  cancellation, and completion.
- Conflict detection and version checks for concurrent appointment changes.
- Offline appointment outbox with account/tenant ownership, idempotent server
  synchronization, and bounded retry/backoff.
- Authenticated sessions backed by Redis and tenant-scoped live update
  notifications.

## Technology

| Layer | Technologies |
|---|---|
| Web client | React, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS |
| API | ASP.NET Core minimal APIs on .NET 10 |
| Operational data | PostgreSQL, EF Core, Npgsql |
| Clinical records | MongoDB |
| Session and cache infrastructure | Redis |
| Browser offline storage | IndexedDB |
| Tests | xUnit and Node.js built-in test runner |

The backend is organized as a modular monolith: API use cases live in
`Hms.Api`, core entities in `Hms.Domain`, and database/provider integrations in
`Hms.Infrastructure`. PostgreSQL stores relational operational data and
scheduling state; MongoDB stores clinical-record documents. Redis stores
active-session state and cache entries.

## Architecture

```text
React / TypeScript browser
  ├── JSON API, SignalR, and SSE ──> ASP.NET Core API
  ├── IndexedDB: appointment outbox and limited patient cache
  └── sessionStorage: browser access token

ASP.NET Core API
  ├── EF Core / Npgsql ────────────> PostgreSQL
  ├── MongoDB.Driver ──────────────> MongoDB clinical_records
  └── StackExchange.Redis ─────────> Redis active sessions/cache
```

## Prerequisites

- .NET 10 SDK
- Node.js and npm
- Docker Desktop or Docker Engine with Docker Compose
- Git

## Run locally (Windows PowerShell)

### 1. Start local data services

From the repository root, create `.env` only if you do not already have one.
Replace the example passwords with local-only values, then start PostgreSQL,
MongoDB, and Redis:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d
```

`.env` is ignored by Git. Keep it private; never use these local settings as
production credentials. PostgreSQL and MongoDB are exposed on local ports
5432 and 27017; Redis is bound to loopback on port 6379.

### 2. Configure the API for development

Create or update the ignored file
`Hms.Api/appsettings.Development.json` with **your local** PostgreSQL,
MongoDB, and JWT settings. The PostgreSQL username/password must match your
Compose `.env`; use a JWT key of at least 32 bytes. This example contains
placeholders only:

```json
{
  "ConnectionStrings": {
    "HmsDatabase": "Host=localhost;Port=5432;Database=hms;Username=hms;Password=<your-local-postgres-password>"
  },
  "Jwt": {
    "Key": "<your-private-random-key-at-least-32-bytes>",
    "Issuer": "Hms.Api",
    "Audience": "Hms.Client"
  },
  "MongoDb": {
    "ConnectionString": "mongodb://<local-mongo-user>:<local-mongo-password>@localhost:27017/?authSource=admin",
    "DatabaseName": "hms_clinical"
  }
}
```

In Development, the API defaults to local Redis at `127.0.0.1:6379` and allows
the Vite origin `http://localhost:5173`. For other environments, configure
`Redis:Configuration` and one or more `Cors:AllowedOrigins` values. The
production API refuses to start without these settings. Production JWT,
database, and MongoDB secrets must be supplied through an approved secret
store or deployment environment—not committed settings files.

### 3. Apply schema and start the API

From the repository root:

```powershell
dotnet restore .\Hms.slnx
dotnet ef database update --project .\Hms.Infrastructure --startup-project .\Hms.Api
dotnet run --project .\Hms.Api --launch-profile http
```

The API's HTTP development URL is `http://localhost:5168`. If `dotnet ef` is
not installed, install a .NET EF Core CLI tool compatible with your SDK.

### 4. Start the web client

In a second PowerShell window:

```powershell
Set-Location .\Hms.Web
npm install
$env:VITE_API_URL = "http://localhost:5168"
npm run dev
```

Open the Vite URL printed in the terminal (normally
`http://localhost:5173`). `VITE_API_URL` can instead be stored in the ignored
`Hms.Web/.env.local` file.

## Tests and quality checks

Run backend tests from the repository root:

```powershell
dotnet test .\Hms.slnx
```

Run frontend checks from `Hms.Web`:

```powershell
npm test
npm run lint
npm run build
```

The backend suite includes role/route authorization, appointment behavior,
active sessions, clinical-record serialization, and offline idempotency tests.
Frontend tests focus on offline synchronization helpers. These tests are not a
substitute for browser end-to-end, security, or load testing.

## Data model

PostgreSQL is the relational source for operational data. EF Core mappings and
schema migrations are in `Hms.Infrastructure/Persistence`.

| Data | Main fields and relationships |
|---|---|
| Users | Unique email, password hash, active session identity. |
| Tenants | Hospital identity, name, and unique slug. |
| Memberships | User-to-hospital link and hospital role; a user may belong to multiple hospitals. |
| Patients | Hospital-owned demographic/contact details and status. |
| Appointments | Hospital, patient, optional doctor, UTC schedule, status, and optimistic-concurrency version. |
| Doctor availability | One UTC date/window per doctor and hospital. |
| Appointment operations | Original offline request/result, uniquely identified by hospital and client operation UUID for safe retries. |

MongoDB stores clinical-record documents containing a patient/hospital
reference, diagnosis, notes, medication and allergy lists, medical history,
and timestamps. Redis stores active session keys and cache data; it is not a
patient-record database. Browser IndexedDB stores a minimal patient cache and
the appointment outbox. No cross-database transaction spans PostgreSQL and
MongoDB.

### Roles and access

The API enforces access by both tenant membership and role; hiding a button in
the web client is not authorization.

| Role | Intended capabilities |
|---|---|
| `admin` | Manage hospital operations and staff memberships; view/manage clinical records. A hospital must retain at least one administrator. |
| `doctor` | View patients, access clinical records, manage appointments, configure doctor availability. |
| `receptionist` | Register patients and manage appointments; no clinical-record access. |
| `staff` | View patients and appointments; no clinical-record access or restricted modifications. |

## Important behavior and design decisions

- **Tenant isolation:** operational records are hospital-scoped. Authenticated
  requests select a tenant, and API handlers must validate tenant ownership for
  every referenced record.
- **Active sessions:** JWT bearer tokens identify the account and session;
  Redis holds the active session for the token's two-hour lifetime. A new login
  replaces the previous active session. Authenticated operations fail closed
  with HTTP 503 when Redis is unavailable.
- **Appointment concurrency:** PostgreSQL coordinates scheduling writes across
  API instances. Availability windows are UTC and split into fixed 30-minute
  slots. Appointment version checks return conflicts for stale edits instead
  of silently replacing newer changes.
- **Offline retry safety:** the browser persists an operation UUID before
  sending it. PostgreSQL records that key in the same transaction as the
  appointment. A matching retry returns the original result; reusing the key
  with different data conflicts. Pending work belongs to its creating user
  and tenant and is not displayed as booked before server confirmation.
- **Realtime notifications:** SSE and SignalR carry update hints, not patient
  details. Current in-memory/best-effort notification paths are not durable
  cross-instance delivery; clients should reload authoritative API data.

## Repository map

```text
Hms.Api/             HTTP API, feature handlers, middleware, auth, real-time
Hms.Domain/          Domain entities and state transitions
Hms.Infrastructure/  EF Core/PostgreSQL, migrations, MongoDB persistence
Hms.Api.Tests/       Backend tests
Hms.Web/             React application and frontend tests
docker-compose.yml   Local PostgreSQL, MongoDB, and Redis
.env.example         Local Compose variable template (placeholders only)
```

## Security and production readiness

Do not deploy this prototype with real patient information. Among other
requirements, a production release needs:

- Threat modeling and independent OWASP-focused security testing.
- Verified tenant isolation, a formal audit trail, access reviews, and
  documented retention/deletion rules.
- HTTPS, managed secrets, encryption-at-rest decisions, dependency scanning,
  rate limits, hardened infrastructure, and monitored incident response.
- Tested encrypted backups and restores for PostgreSQL and MongoDB, plus a
  recovery plan for Redis-backed sessions.
- A deployment architecture, availability targets, migration/rollback plan,
  observability, and realistic concurrency/load testing.

The current in-memory/best-effort real-time notification paths are not a
durable multi-instance event system. Local Docker Compose is for development,
not production deployment guidance. Recheck the implementation and tests
before changing security, tenancy, persistence, or scheduling behavior.

## Contributing

1. Read this README and the relevant existing feature code.
2. Keep API authorization and tenant checks on the server; UI visibility is
   not an access-control boundary.
3. Include regression tests for behavior changes and update EF migrations
   when PostgreSQL schema changes.
4. Run relevant backend/frontend tests, lint, and build checks before
   submitting changes.
5. Never commit `.env`, local appsettings, tokens, credentials, or patient
   data.

## License

No license file is currently included. Unless the repository owner adds a
license, usage and redistribution permissions are not granted by this README.
