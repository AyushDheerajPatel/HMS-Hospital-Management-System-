# HMS web application

The React application provides hospital registration, tenant selection, patient
management, clinical records, doctor availability and appointment scheduling,
and an IndexedDB appointment outbox for temporary network outages.

## Production readiness

This application is not ready for real patient information. Treat it as a
development prototype until deployment configuration, privacy controls, access
and audit requirements, data retention and recovery, and production security
have been reviewed and implemented. Configure production secrets and service
endpoints outside the repository, use HTTPS, and set the API's allowed web
origins for the deployed frontend with the API configuration key
`Cors__AllowedOrigins__0` (and subsequent indexed values for additional
origins). Outside Development, the API refuses to start if no allowed origin
or `Redis__Configuration` is configured. The development settings and local
Docker configuration are not production deployment guidance, and this project
does not claim regulatory compliance.

## Development

Install dependencies and run the Vite development server from this directory:

```sh
npm install
npm run dev
```

The offline service worker is enabled for production builds, not Vite development.
If an older development service worker is registered, the development app
unregisters it and clears its HMS shell cache so it cannot serve stale frontend
code.

Set `VITE_API_URL` to the API origin in the local Vite environment. The API must
be configured with PostgreSQL and a JWT signing key before authenticated flows
can be used. From the repository root, apply the EF Core migrations before
starting the API:

```sh
dotnet ef database update --project Hms.Infrastructure --startup-project Hms.Api
```

## Session and offline behavior

- A successful login replaces the account's active session. Signing in on a
  second browser or device invalidates the earlier token; signing out revokes
  the current token on the server. Redis stores one random session ID per
  immutable user ID with the same two-hour TTL as the access token. Session
  replacement is atomic; logout uses an atomic compare-and-delete so an older
  token cannot revoke a newer login. `POST /api/auth/logout-all` revokes the
  account's single active session and signs out the current device as well.
  `GET /api/auth/session` verifies a restored sign-in before the frontend opens
  protected pages.
- Redis is required for authenticated requests and login session issuance. If
  Redis is unavailable, protected requests, login, and logout fail closed with
  HTTP 503; the API does not bypass session checks. The frontend keeps a saved
  sign-in while session verification is unavailable and blocks protected UI
  until verification can be retried. Public health and account registration
  remain available. Restore Redis connectivity and retry; session state is not
  reconstructed from JWTs or PostgreSQL. After deploying this Redis-backed
  session mechanism, users must sign in again because existing tokens have no
  corresponding active-session key.
- Queued appointment operations retain a stable operation ID and are persisted
  before the app attempts synchronization. This UUID is sent as
  `clientOperationId` to `POST /api/sync/appointments` and reused on every
  retry. PostgreSQL stores the original request and result in
  `appointment_operations`, uniquely keyed by `(TenantId, ClientOperationId)`,
  in the same transaction as the appointment. A repeated matching request
  returns the original result; reusing the key with different data returns
  HTTP 409.
- Offline operations are stored with the authenticated user ID and tenant ID.
  The app only submits an operation when both match the verified current
  session. Operations from another account are retained and shown as belonging
  to that account. Signing out warns before discarding the current account's
  unsynchronized operations; expiring a session preserves them.
- Queued appointments are confirmed on the current device and remain visibly
- Queued appointments remain pending and are not shown as booked until a
  successful API response changes the state to Synced and stores the
  server-returned appointment. Permanent validation, authorization, and slot
  conflicts remain visible for manual review. Recoverable network, timeout,
  HTTP 408, HTTP 429, and HTTP 5xx failures remain pending with bounded
  exponential backoff and jitter; the worker honors `Retry-After`. Sync runs at
  startup and after reconnect, and the Web Locks API prevents competing tabs
  from running workers for the same tenant when supported.
- Doctor scheduling uses `GET /api/appointments/doctors`,
  `GET /api/appointments/availability?doctorId=...&date=YYYY-MM-DD`, and
  `PUT /api/appointments/availability`. An administrator or the selected
  doctor configures one UTC availability window per future date; the project
  assumes no hospital working hours. Windows contain fixed 30-minute slots.
  Existing appointments without a historical doctor assignment remain
  unassigned rather than being attributed to a doctor; they conservatively
  block overlapping slots for all doctors in that hospital until no longer
  scheduled. Doctor membership and patient tenancy are checked by the API.
- PostgreSQL serializes appointment creation, rescheduling, cancellation, and
  availability updates on the selected doctor's `users` row with
  `SELECT ... FOR UPDATE` inside a database transaction. This lock is shared
  across API instances. The server then checks the active appointment interval
  and availability before writing; a raced booking returns HTTP 409. Cancelled
  appointments stop occupying a slot in the same transaction that marks them
  cancelled. Idempotency records include the doctor selection, so a retry
  returns its original result while reusing the key for a different booking
  conflicts. The optional waiting list is deferred.
- The app uses an authenticated Server-Sent Events stream to receive
  tenant-scoped appointment change notifications. Notifications carry no
  patient details; the app reloads data through the normal authenticated API.
  The in-memory event broker is intended for a single API instance.
- Appointment rescheduling includes the version last read by the client.
  Concurrent updates return a conflict instead of silently overwriting the
  newer schedule.
- Appointment editing and cancellation/completion are role-limited and version
  checked. Only scheduled appointments can be changed or transitioned.
- Hospital roles are enforced by the API, not only by the UI: `admin` can
  manage hospital operations, `doctor` can read patients, manage clinical
  records, and manage appointments, `receptionist` can create patients and
  manage appointments, and `staff` can view patients and appointments.
  Clinical records are restricted to administrators and doctors.
- Administrators can add existing HMS accounts to their hospital, assign or
  change the four supported roles, and remove memberships from the Settings
  screen. A hospital retains at least one administrator. Staff accounts can be
  created from the sign-in screen; after an administrator adds an account, that
  person should sign in again to refresh their hospital list.
- Authorized administrators and doctors can create, view, edit, and delete
  patient clinical records, including diagnoses, notes, prescriptions,
  allergies, and medical history.

Run the frontend checks from this directory:

```sh
dotnet run --project .\Hms.Api --launch-profile http
npm run build
npm run lint
npm test
```

Run backend tests from the repository root with `dotnet test Hms.slnx`.
