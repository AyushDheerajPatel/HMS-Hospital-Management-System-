import type { OfflineAppointment } from "./offlineStore";

const API_URL = import.meta.env.VITE_API_URL;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export type TenantAccess = {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
};

export type LoginResponse = {
  accessToken: string;
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

export type Appointment = {
  id: string;
  patientId: string;
  scheduledAtUtc: string;
  reason: string;
  status: string;
  createdAtUtc: string;
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
  throw new ApiError(message, response.status);
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

export async function createAppointment(
  patientId: string,
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

export async function synchronizeAppointment(
  operation: OfflineAppointment,
  tenantId: string,
): Promise<Appointment> {
  if (!operation.reason) {
    throw new Error("The appointment operation is missing its queued details.");
  }

  const response = await fetch(`${API_URL}/api/sync/appointments`, {
    method: "POST",
    headers: {
      ...authenticatedHeaders(tenantId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      patientId: operation.patientId,
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
