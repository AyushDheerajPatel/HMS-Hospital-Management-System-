import {
  HubConnection,
  HubConnectionBuilder,
  HttpTransportType,
  LogLevel,
} from "@microsoft/signalr";
import type { OfflineAppointment } from "./offlineStore";
import { parseRetryAfterMs } from "./offlineSync";

const API_URL = import.meta.env.VITE_API_URL;

export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.name = "ApiError";
  }
}

export type TenantAccess = {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
};

export type HospitalMembership = {
  membershipId: string;
  userId: string;
  email: string;
  role: string;
};

export type LoginResponse = {
  accessToken: string;
  userId: string;
  tenants: TenantAccess[];
};

export type TenantRegistration = {
  tenantId: string;
  name: string;
  slug: string;
  administratorEmail: string;
};

export type Patient = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string | null;
  email: string | null;
  status: string;
  createdAtUtc: string;
};

export type PatientResponse = {
  items: Patient[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type PatientDraft = Pick<
  Patient,
  "firstName" | "lastName" | "dateOfBirth" | "phone" | "email"
>;

export type ClinicalRecord = {
  id: string;
  tenantId: string;
  patientId: string;
  diagnosis: string;
  notes: string;
  medications: string[];
  allergies: string[];
  medicalHistory: string;
  createdAtUtc: string;
  updatedAtUtc: string;
};

export type ClinicalRecordDraft = Pick<
  ClinicalRecord,
  "diagnosis" | "notes" | "medications" | "allergies" | "medicalHistory"
>;

export type Appointment = {
  id: string;
  patientId: string;
  doctorId: string | null;
  scheduledAtUtc: string;
  reason: string;
  status: string;
  createdAtUtc: string;
  version: number;
};

export type AppointmentDoctor = {
  id: string;
  email: string;
};

export type AppointmentAvailability = {
  doctorId: string;
  date: string;
  startTimeUtc: string;
  endTimeUtc: string;
  slotDurationMinutes: number;
};

export type AppointmentResponse = {
  items: Appointment[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type DashboardStats = {
  patientCount: number;
  activePatientCount: number;
  upcomingAppointmentCount: number;
};

async function getErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) {
    return `Request failed (${response.status}).`;
  }

  try {
    const problem = JSON.parse(body) as { detail?: string; error?: string };
    return problem.detail ?? problem.error ?? body;
  } catch {
    return body;
  }
}

async function throwResponseError(response: Response): Promise<never> {
  const message = await getErrorMessage(response);
  if (response.status === 401) {
    throw new ApiError("Session expired. Please sign in again.", response.status);
  }
  const retryAfterMs = parseRetryAfterMs(
    response.headers.get("Retry-After"),
  );
  throw new ApiError(message, response.status, retryAfterMs);
}

function authenticatedHeaders(tenantId: string): Record<string, string> {
  const token = sessionStorage.getItem("accessToken");
  if (!token) {
    throw new Error("Session expired. Please sign in again.");
  }

  return {
    Authorization: `Bearer ${token}`,
    "X-Tenant-Id": tenantId,
  };
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    return throwResponseError(response);
  }

  return response.json() as Promise<LoginResponse>;
}

export async function validateSession(signal?: AbortSignal): Promise<string> {
  const token = sessionStorage.getItem("accessToken");
  if (!token) {
    throw new ApiError("Session expired. Please sign in again.", 401);
  }

  const response = await fetch(`${API_URL}/api/auth/session`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) return throwResponseError(response);
  const result = await response.json() as { userId: string };
  return result.userId;
}

export async function registerAccount(
  email: string,
  password: string,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) return throwResponseError(response);
}

export async function logout(): Promise<void> {
  return revokeSession("/api/auth/logout");
}

export async function logoutAllDevices(): Promise<void> {
  return revokeSession("/api/auth/logout-all");
}

async function revokeSession(path: string): Promise<void> {
  const token = sessionStorage.getItem("accessToken");
  if (!token) return;

  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return throwResponseError(response);
  }
}

export type HospitalAppointmentUpdate = {
  appointmentId: string;
  tenantId: string;
  status: string;
  updatedAtUtc: string;
  eventType: string;
};

export type SessionRevokedNotification = {
  userId: string;
  sessionId: string;
  reason: string;
  revokedAtUtc: string;
};

export async function createHospitalConnection(
  tenantId: string,
  onAppointmentChange: () => void,
): Promise<HubConnection> {
  const connection = new HubConnectionBuilder()
    .withUrl(`${API_URL}/hubs/hospital`, {
      accessTokenFactory: () => sessionStorage.getItem("accessToken") ?? "",
      transport: HttpTransportType.WebSockets,
      withCredentials: true,
    })
    .withAutomaticReconnect([0, 1000, 3000, 5000])
    .configureLogging(LogLevel.Warning)
    .build();

  connection.on("AppointmentUpdated", (event: HospitalAppointmentUpdate) => {
    if (event.tenantId === tenantId) {
      onAppointmentChange();
    }
  });

  connection.on("SessionRevoked", (event: SessionRevokedNotification) => {
    if (event.userId === sessionStorage.getItem("userId")) {
      window.dispatchEvent(new Event("hms:unauthorized"));
    }
  });

  try {
    await connection.start();
  } catch (error) {
    if (
      error instanceof Error &&
      /Status code ['"]401['"]/.test(error.message)
    ) {
      throw new ApiError("Session expired. Please sign in again.", 401);
    }
    throw error;
  }
  return connection;
}

export async function listenForHospitalUpdates(
  tenantId: string,
  signal: AbortSignal,
  onAppointmentChange: () => void,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/appointments/updates`, {
    headers: {
      ...authenticatedHeaders(tenantId),
      Accept: "text/event-stream",
    },
    signal,
  });
  if (!response.ok) {
    return throwResponseError(response);
  }
  if (!response.body) {
    throw new Error("The server did not provide a live updates stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        if (event.split(/\r?\n/).some((line) => line === "event: appointment.changed")) {
          onAppointmentChange();
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function registerTenant(
  name: string,
  slug: string,
  administratorEmail: string,
  administratorPassword: string,
): Promise<TenantRegistration> {
  const response = await fetch(`${API_URL}/api/tenants/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      slug,
      administratorEmail,
      administratorPassword,
    }),
  });

  if (!response.ok) {
    return throwResponseError(response);
  }

  return response.json() as Promise<TenantRegistration>;
}

export async function getHospitalMemberships(
  tenantId: string,
): Promise<HospitalMembership[]> {
  const response = await fetch(`${API_URL}/api/memberships`, {
    headers: authenticatedHeaders(tenantId),
  });
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<HospitalMembership[]>;
}

export async function addHospitalMembership(
  email: string,
  role: string,
  tenantId: string,
): Promise<HospitalMembership> {
  const response = await fetch(`${API_URL}/api/memberships`, {
    method: "POST",
    headers: {
      ...authenticatedHeaders(tenantId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: email.trim(), role }),
  });
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<HospitalMembership>;
}

export async function updateHospitalMembershipRole(
  membershipId: string,
  role: string,
  tenantId: string,
): Promise<HospitalMembership> {
  const response = await fetch(
    `${API_URL}/api/memberships/${membershipId}`,
    {
      method: "PUT",
      headers: {
        ...authenticatedHeaders(tenantId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role }),
    },
  );
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<HospitalMembership>;
}

export async function removeHospitalMembership(
  membershipId: string,
  tenantId: string,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/memberships/${membershipId}`,
    { method: "DELETE", headers: authenticatedHeaders(tenantId) },
  );
  if (!response.ok) return throwResponseError(response);
}

export async function getPatients(
  search: string,
  page: number,
  tenantId: string,
  pageSize = 10,
): Promise<PatientResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search.trim()) {
    params.set("search", search.trim());
  }

  const response = await fetch(
    `${API_URL}/api/patients?${params.toString()}`,
    { headers: authenticatedHeaders(tenantId) },
  );

  if (!response.ok) {
    return throwResponseError(response);
  }
  return response.json() as Promise<PatientResponse>;
}

export async function getPatient(
  patientId: string,
  tenantId: string,
): Promise<Patient> {
  const response = await fetch(
    `${API_URL}/api/patients/${encodeURIComponent(patientId)}`,
    { headers: authenticatedHeaders(tenantId) },
  );

  if (!response.ok) {
    return throwResponseError(response);
  }
  return response.json() as Promise<Patient>;
}

export async function createPatient(
  draft: PatientDraft,
  tenantId: string,
): Promise<Patient> {
  const response = await fetch(`${API_URL}/api/patients`, {
    method: "POST",
    headers: {
      ...authenticatedHeaders(tenantId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(draft),
  });
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<Patient>;
}

export async function getClinicalRecords(
  patientId: string,
  tenantId: string,
): Promise<ClinicalRecord[]> {
  const records: ClinicalRecord[] = [];
  const pageSize = 100;
  let page = 1;
  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    const response = await fetch(
      `${API_URL}/api/patients/${patientId}/clinical-records?${params}`,
      { headers: authenticatedHeaders(tenantId) },
    );
    if (!response.ok) return throwResponseError(response);
    const items = await response.json() as ClinicalRecord[];
    records.push(...items);
    if (items.length < pageSize) return records;
    page += 1;
  }
}

export async function createClinicalRecord(
  patientId: string,
  draft: ClinicalRecordDraft,
  tenantId: string,
): Promise<ClinicalRecord> {
  const response = await fetch(
    `${API_URL}/api/patients/${patientId}/clinical-records`,
    {
      method: "POST",
      headers: {
        ...authenticatedHeaders(tenantId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(draft),
    },
  );
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<ClinicalRecord>;
}

export async function updateClinicalRecord(
  patientId: string,
  recordId: string,
  draft: ClinicalRecordDraft,
  tenantId: string,
): Promise<ClinicalRecord> {
  const response = await fetch(
    `${API_URL}/api/patients/${patientId}/clinical-records/${recordId}`,
    {
      method: "PUT",
      headers: {
        ...authenticatedHeaders(tenantId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(draft),
    },
  );
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<ClinicalRecord>;
}

export async function deleteClinicalRecord(
  patientId: string,
  recordId: string,
  tenantId: string,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/patients/${patientId}/clinical-records/${recordId}`,
    { method: "DELETE", headers: authenticatedHeaders(tenantId) },
  );
  if (!response.ok) return throwResponseError(response);
}

export async function getAppointments(
  status: string,
  page: number,
  tenantId: string,
  pageSize = 10,
): Promise<AppointmentResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (status) {
    params.set("status", status);
  }

  const response = await fetch(
    `${API_URL}/api/appointments?${params.toString()}`,
    { headers: authenticatedHeaders(tenantId) },
  );

  if (!response.ok) {
    return throwResponseError(response);
  }
  return response.json() as Promise<AppointmentResponse>;
}

export async function getAppointmentDoctors(
  tenantId: string,
): Promise<AppointmentDoctor[]> {
  const response = await fetch(`${API_URL}/api/appointments/doctors`, {
    headers: authenticatedHeaders(tenantId),
  });
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<AppointmentDoctor[]>;
}

export async function getAvailableAppointmentSlots(
  doctorId: string,
  date: string,
  tenantId: string,
): Promise<string[]> {
  const params = new URLSearchParams({ doctorId, date });
  const response = await fetch(
    `${API_URL}/api/appointments/availability?${params}`,
    { headers: authenticatedHeaders(tenantId) },
  );
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<string[]>;
}

export async function setDoctorAvailability(
  availability: {
    doctorId: string;
    date: string;
    startTimeUtc: string;
    endTimeUtc: string;
  },
  tenantId: string,
): Promise<AppointmentAvailability> {
  const response = await fetch(`${API_URL}/api/appointments/availability`, {
    method: "PUT",
    headers: {
      ...authenticatedHeaders(tenantId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(availability),
  });
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<AppointmentAvailability>;
}

export async function createAppointment(
  patientId: string,
  doctorId: string,
  scheduledAt: string,
  reason: string,
  tenantId: string,
  clientOperationId: string,
): Promise<Appointment> {
  const response = await fetch(`${API_URL}/api/sync/appointments`, {
    method: "POST",
    headers: {
      ...authenticatedHeaders(tenantId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      patientId,
      doctorId,
      scheduledAtUtc: new Date(scheduledAt).toISOString(),
      reason: reason.trim(),
      clientOperationId,
    }),
  });

  if (!response.ok) {
    return throwResponseError(response);
  }
  return response.json() as Promise<Appointment>;
}

export async function rescheduleAppointment(
  appointmentId: string,
  scheduledAt: string,
  expectedVersion: number,
  tenantId: string,
): Promise<Appointment> {
  const response = await fetch(
    `${API_URL}/api/appointments/${appointmentId}/schedule`,
    {
      method: "PUT",
      headers: {
        ...authenticatedHeaders(tenantId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scheduledAtUtc: new Date(scheduledAt).toISOString(),
        expectedVersion,
      }),
    },
  );
  if (!response.ok) {
    return throwResponseError(response);
  }
  return response.json() as Promise<Appointment>;
}

export async function updateAppointment(
  appointmentId: string,
  patientId: string,
  scheduledAt: string,
  reason: string,
  expectedVersion: number,
  tenantId: string,
): Promise<Appointment> {
  const response = await fetch(`${API_URL}/api/appointments/${appointmentId}`, {
    method: "PUT",
    headers: {
      ...authenticatedHeaders(tenantId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      patientId,
      scheduledAtUtc: new Date(scheduledAt).toISOString(),
      reason: reason.trim(),
      expectedVersion,
    }),
  });
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<Appointment>;
}

export async function changeAppointmentStatus(
  appointmentId: string,
  status: "cancelled" | "completed",
  expectedVersion: number,
  tenantId: string,
): Promise<Appointment> {
  const response = await fetch(
    `${API_URL}/api/appointments/${appointmentId}/status`,
    {
      method: "PATCH",
      headers: {
        ...authenticatedHeaders(tenantId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status, expectedVersion }),
    },
  );
  if (!response.ok) return throwResponseError(response);
  return response.json() as Promise<Appointment>;
}

export async function synchronizeAppointment(
  operation: OfflineAppointment,
  tenantId: string,
  accessToken: string,
): Promise<Appointment> {
  if (!operation.reason) {
    throw new Error("The appointment operation is missing its queued details.");
  }
  if (!operation.doctorId) {
    throw new Error(
      "This queued appointment has no saved doctor. Choose a doctor before retrying it.",
    );
  }
  if (operation.tenantId !== tenantId) {
    throw new Error("The queued appointment belongs to a different hospital.");
  }

  const response = await fetch(`${API_URL}/api/sync/appointments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Tenant-Id": tenantId,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      patientId: operation.patientId,
      doctorId: operation.doctorId,
      scheduledAtUtc: operation.scheduledAtUtc,
      reason: operation.reason,
      clientOperationId: operation.operationId,
    }),
  });

  if (!response.ok) {
    return throwResponseError(response);
  }
  return response.json() as Promise<Appointment>;
}

export async function getDashboardStats(
  tenantId: string,
): Promise<DashboardStats> {
  const response = await fetch(`${API_URL}/api/dashboard/stats`, {
    headers: authenticatedHeaders(tenantId),
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }
  return response.json() as Promise<DashboardStats>;
}
