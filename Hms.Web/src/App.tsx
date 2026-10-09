import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
} from "lucide-react";
import {
  createAppointment,
  getAppointments,
  getPatients,
  login,
  type Appointment,
  type Patient,
} from "./api";
import "./App.css";

type Page = "Dashboard" | "Patients" | "Appointments" | "Settings";

function App() {
  const [email, setEmail] = useState("admin@cityhospital.com");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [token, setToken] = useState(
    () => sessionStorage.getItem("accessToken") ?? ""
  );
  const [page, setPage] = useState<Page>("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Patients
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientPage, setPatientPage] = useState(1);
  const [patientTotal, setPatientTotal] = useState(0);
  const [patientTotalPages, setPatientTotalPages] = useState(0);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState("");
  const [patientRetry, setPatientRetry] = useState(0);

  // Appointments
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentStatus, setAppointmentStatus] = useState("");
  const [appointmentLoading, setAppointmentLoading] = useState(false);
  const [appointmentError, setAppointmentError] = useState("");
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentTotal, setAppointmentTotal] = useState(0);
  const [appointmentTotalPages, setAppointmentTotalPages] = useState(0);
  const [appointmentRetry, setAppointmentRetry] = useState(0);

  // Create appointment form
  const [appointmentPatients, setAppointmentPatients] = useState<Patient[]>([]);
  const [newPatientId, setNewPatientId] = useState("");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newAppointmentReason, setNewAppointmentReason] = useState("");
  const [creatingAppointment, setCreatingAppointment] = useState(false);
  const [createAppointmentMessage, setCreateAppointmentMessage] = useState("");

  // Load patients for the directory and dashboard count.
  useEffect(() => {
    if (!token || (page !== "Patients" && page !== "Dashboard")) return;

    let cancelled = false;

    async function loadPatients() {
      setPatientLoading(true);
      setPatientError("");

      try {
        const result = await getPatients(
          page === "Dashboard" ? "" : patientSearch,
          page === "Dashboard" ? 1 : patientPage,
          10
        );

        if (cancelled) return;

        if (page === "Dashboard") {
          setPatientTotal(result.totalCount);
        } else {
          setPatients(result.items);
          setPatientTotal(result.totalCount);
          setPatientTotalPages(result.totalPages);
        }
      } catch (error) {
        if (!cancelled) {
          setPatientError(
            error instanceof Error ? error.message : "Unable to load patients."
          );
        }
      } finally {
        if (!cancelled) setPatientLoading(false);
      }
    }

    void loadPatients();

    return () => {
      cancelled = true;
    };
  }, [token, page, patientSearch, patientPage, patientRetry]);

  // Load appointments for the appointments page and dashboard count.
  useEffect(() => {
    if (!token || (page !== "Appointments" && page !== "Dashboard")) return;

    let cancelled = false;

    async function loadAppointments() {
      setAppointmentLoading(true);
      setAppointmentError("");

      try {
        const result = await getAppointments(
          page === "Dashboard" ? "" : appointmentStatus,
          page === "Dashboard" ? 1 : appointmentPage,
          10
        );

        if (cancelled) return;

        setAppointments(result.items);
        setAppointmentTotal(result.totalCount);
        setAppointmentTotalPages(result.totalPages);
      } catch (error) {
        if (!cancelled) {
          setAppointmentError(
            error instanceof Error
              ? error.message
              : "Unable to load appointments."
          );
        }
      } finally {
        if (!cancelled) setAppointmentLoading(false);
      }
    }

    void loadAppointments();

    return () => {
      cancelled = true;
    };
  }, [token, page, appointmentStatus, appointmentPage, appointmentRetry]);

  // Load patient choices for the create-appointment form.
  useEffect(() => {
    if (!token || page !== "Appointments") return;

    let cancelled = false;

    async function loadAppointmentPatients() {
      try {
        const result = await getPatients("", 1, 100);
        if (!cancelled) setAppointmentPatients(result.items);
      } catch {
        if (!cancelled) {
          setCreateAppointmentMessage(
            "Unable to load patients for the appointment form."
          );
        }
      }
    }

    void loadAppointmentPatients();

    return () => {
      cancelled = true;
    };
  }, [token, page]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginLoading(true);
    setMessage("");

    try {
      const result = await login(email, password);
      const accessToken = result.accessToken ?? result.token;

      if (!accessToken) {
        throw new Error("Login response did not contain a token.");
      }

      sessionStorage.setItem("accessToken", accessToken);
      setToken(accessToken);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleCreateAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingAppointment(true);
    setCreateAppointmentMessage("");

    try {
      await createAppointment(
        newPatientId,
        newScheduledAt,
        newAppointmentReason
      );

      setCreateAppointmentMessage("Appointment created successfully.");
      setNewPatientId("");
      setNewScheduledAt("");
      setNewAppointmentReason("");
      setAppointmentPage(1);
      setAppointmentRetry((current) => current + 1);
    } catch (error) {
      setCreateAppointmentMessage(
        error instanceof Error ? error.message : "Unable to create appointment."
      );
    } finally {
      setCreatingAppointment(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("accessToken");
    setToken("");
    setPassword("");
    setMessage("");
    setPage("Dashboard");
  }

  if (!token) {
    return (
      <main className="login-page">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="brand-icon">
            <Activity size={28} />
          </div>
          <h1>City Hospital</h1>
          <p>Hospital Management System</p>

          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <button type="submit" disabled={loginLoading}>
            {loginLoading ? "Signing in..." : "Sign in"}
          </button>

          {message && <p role="alert">{message}</p>}
        </form>
      </main>
    );
  }

  const navigation: { name: Page; icon: typeof LayoutDashboard }[] = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Patients", icon: Users },
    { name: "Appointments", icon: CalendarDays },
    { name: "Settings", icon: Settings },
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "" : "sidebar-closed"}`}>
        <div className="sidebar-brand">
          <Activity size={27} />
          {sidebarOpen && <span>City Hospital</span>}
        </div>

        <p className="nav-heading">{sidebarOpen ? "WORKSPACE" : ""}</p>

        <nav>
          {navigation.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${page === name ? "active" : ""}`}
              onClick={() => setPage(name)}
              title={name}
              type="button"
            >
              <Icon size={20} />
              {sidebarOpen && <span>{name}</span>}
            </button>
          ))}
        </nav>

        <button className="nav-item logout" onClick={handleLogout} type="button">
          <LogOut size={20} />
          {sidebarOpen && <span>Sign out</span>}
        </button>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle sidebar"
            type="button"
          >
            <Menu size={21} />
          </button>
          <div className="topbar-right">
            <span className="status-dot" />
            <span>Administrator</span>
          </div>
        </header>

        <section className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CITY HOSPITAL / WORKSPACE</p>
              <h1>{page}</h1>
              <p className="subtitle">
                {page === "Dashboard"
                  ? "Here's an overview of your hospital."
                  : `Manage your hospital ${page.toLowerCase()}.`}
              </p>
            </div>
            <span className="today-badge">Hospital Admin</span>
          </div>

          {page === "Dashboard" ? (
            <>
              <div className="welcome-card">
                <div>
                  <p className="welcome-label">HOSPITAL OVERVIEW</p>
                  <h2>Welcome back!</h2>
                  <p>Manage patients and appointments from one place.</p>
                </div>
                <Activity size={54} />
              </div>

              <div className="stats-grid">
                <article className="stat-card">
                  <div className="stat-icon blue"><Users /></div>
                  <p>Total Patients</p>
                  <h2>{patientTotal}</h2>
                  <span>Registered patients</span>
                </article>

                <article className="stat-card">
                  <div className="stat-icon green"><CalendarDays /></div>
                  <p>Appointments</p>
                  <h2>{appointmentTotal}</h2>
                  <span>Appointments loaded from the API</span>
                </article>

                <article className="stat-card">
                  <div className="stat-icon purple"><Activity /></div>
                  <p>System Status</p>
                  <h2>Online</h2>
                  <span>Dashboard is running</span>
                </article>
              </div>

              {(patientError || appointmentError) && (
                <section className="panel">
                  <p role="alert">{patientError || appointmentError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setPatientRetry((current) => current + 1);
                      setAppointmentRetry((current) => current + 1);
                    }}
                  >
                    Retry dashboard data
                  </button>
                </section>
              )}

              <section className="panel">
                <h3>Quick actions</h3>
                <p className="subtitle">Choose a section to continue working.</p>
                <div className="quick-actions">
                  <button onClick={() => setPage("Patients")} type="button">
                    <Users size={19} /> View Patients
                  </button>
                  <button onClick={() => setPage("Appointments")} type="button">
                    <CalendarDays size={19} /> View Appointments
                  </button>
                </div>
              </section>
            </>
          ) : page === "Patients" ? (
            <section className="panel patients-panel">
              <div className="patients-toolbar">
                <div>
                  <h2>Patient Directory</h2>
                  <p className="subtitle">
                    {patientTotal} patient{patientTotal === 1 ? "" : "s"} registered
                  </p>
                </div>
                <input
                  className="patient-search"
                  type="search"
                  placeholder="Search name or phone..."
                  value={patientSearch}
                  onChange={(event) => {
                    setPatientSearch(event.target.value);
                    setPatientPage(1);
                  }}
                />
              </div>

              {patientLoading ? (
                <p className="patients-message">Loading patients...</p>
              ) : patientError ? (
                <div className="patients-error" role="alert">
                  <p>{patientError}</p>
                  <button
                    type="button"
                    onClick={() => setPatientRetry((current) => current + 1)}
                  >
                    Retry
                  </button>
                </div>
              ) : patients.length === 0 ? (
                <p className="patients-message">No patients found.</p>
              ) : (
                <div className="table-scroll">
                  <table className="patients-table">
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>Phone</th>
                        <th>Email</th>
                        <th>Date of Birth</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patients.map((patient) => (
                        <tr key={patient.id}>
                          <td>
                            <div className="patient-name">
                              {patient.firstName} {patient.lastName}
                            </div>
                            <div className="patient-id">
                              ID: {patient.id.slice(0, 8)}
                            </div>
                          </td>
                          <td>{patient.phone || "—"}</td>
                          <td>{patient.email || "—"}</td>
                          <td>{patient.dateOfBirth}</td>
                          <td>
                            <span className={`patient-status ${patient.status.toLowerCase()}`}>
                              {patient.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="pagination">
                <span>Page {patientPage} of {Math.max(patientTotalPages, 1)}</span>
                <div>
                  <button
                    type="button"
                    disabled={patientPage <= 1 || patientLoading}
                    onClick={() => setPatientPage((current) => current - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={patientPage >= patientTotalPages || patientLoading}
                    onClick={() => setPatientPage((current) => current + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          ) : page === "Appointments" ? (
            <section className="panel patients-panel">
              <div className="patients-toolbar">
                <div>
                  <h2>Appointments</h2>
                  <p className="subtitle">{appointmentTotal} appointment(s) found</p>
                </div>
                <select
                  value={appointmentStatus}
                  onChange={(event) => {
                    setAppointmentStatus(event.target.value);
                    setAppointmentPage(1);
                  }}
                  aria-label="Filter appointments by status"
                >
                  <option value="">All statuses</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <form className="appointment-form" onSubmit={handleCreateAppointment}>
                <h3>Schedule an Appointment</h3>

                <label htmlFor="appointment-patient">Patient</label>
                <select
                  id="appointment-patient"
                  value={newPatientId}
                  onChange={(event) => setNewPatientId(event.target.value)}
                  required
                >
                  <option value="">Select a patient</option>
                  {appointmentPatients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.firstName} {patient.lastName}
                    </option>
                  ))}
                </select>

                <label htmlFor="appointment-date">Date and time</label>
                <input
                  id="appointment-date"
                  type="datetime-local"
                  value={newScheduledAt}
                  onChange={(event) => setNewScheduledAt(event.target.value)}
                  min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
                    .toISOString()
                    .slice(0, 16)}
                  required
                />

                <label htmlFor="appointment-reason">Reason</label>
                <input
                  id="appointment-reason"
                  value={newAppointmentReason}
                  onChange={(event) => setNewAppointmentReason(event.target.value)}
                  placeholder="Enter appointment reason"
                  required
                />

                <button type="submit" disabled={creatingAppointment}>
                  {creatingAppointment ? "Saving..." : "Create Appointment"}
                </button>

                {createAppointmentMessage && (
                  <p role="status">{createAppointmentMessage}</p>
                )}
              </form>

              {appointmentLoading ? (
                <p className="patients-message">Loading appointments...</p>
              ) : appointmentError ? (
                <div className="patients-error" role="alert">
                  <p>{appointmentError}</p>
                  <button
                    type="button"
                    onClick={() => setAppointmentRetry((current) => current + 1)}
                  >
                    Retry
                  </button>
                </div>
              ) : appointments.length === 0 ? (
                <p className="patients-message">No appointments found.</p>
              ) : (
                <div className="table-scroll">
                  <table className="patients-table">
                    <thead>
                      <tr>
                        <th>Patient ID</th>
                        <th>Date &amp; Time</th>
                        <th>Reason</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appointments.map((appointment) => (
                        <tr key={appointment.id}>
                          <td title={appointment.patientId}>
                            {appointment.patientId.slice(0, 8)}...
                          </td>
                          <td>{new Date(appointment.scheduledAtUtc).toLocaleString()}</td>
                          <td>{appointment.reason}</td>
                          <td>
                            <span className={`patient-status ${appointment.status.toLowerCase()}`}>
                              {appointment.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="pagination">
                <span>
                  Page {appointmentPage} of {Math.max(appointmentTotalPages, 1)}
                </span>
                <div>
                  <button
                    type="button"
                    disabled={appointmentPage <= 1 || appointmentLoading}
                    onClick={() => setAppointmentPage((current) => current - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={
                      appointmentPage >= appointmentTotalPages ||
                      appointmentLoading ||
                      appointmentTotalPages === 0
                    }
                    onClick={() => setAppointmentPage((current) => current + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <section className="panel">
              <h2>Settings</h2>
              <p className="subtitle">Hospital settings will be added later.</p>
            </section>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
