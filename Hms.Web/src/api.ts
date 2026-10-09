
const API_URL = import.meta.env.VITE_API_URL;

export async function login(email: string, password: string) {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error("Login failed. Check your email and password.");
  }

  return response.json();
}

const TENANT_ID = "2b9547c3-c10d-4b05-8cd7-62347830a4ca";

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

export async function getPatients(
  search: string,
  page: number,
  pageSize = 10
): Promise<PatientResponse> {
  const token = sessionStorage.getItem("accessToken");

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (search.trim()) {
    params.set("search", search.trim());
  }

  const response = await fetch(
    `${API_URL}/api/patients?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Tenant-Id": TENANT_ID,
      },
    }
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Session expired. Please sign in again.");
    }

    if (response.status === 403) {
      throw new Error("You do not have access to this hospital.");
    }

    throw new Error(`Unable to load patients (${response.status}).`);
  }

  return response.json();
}

const APPOINTMENTS_TENANT_ID =
  "2b9547c3-c10d-4b05-8cd7-62347830a4ca";

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

export async function getAppointments(
  status = "",
  page = 1,
  pageSize = 10
): Promise<AppointmentResponse> {
  const token = sessionStorage.getItem("accessToken");

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (status) {
    params.set("status", status);
  }

  const response = await fetch(
    `${API_URL}/api/appointments?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Tenant-Id": APPOINTMENTS_TENANT_ID,
      },
    }
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Session expired. Please sign in again.");
    }

    if (response.status === 403) {
      throw new Error("You do not have access to this hospital.");
    }

    throw new Error(`Unable to load appointments (${response.status}).`);
  }

  return response.json();
}

export async function createAppointment(
  patientId: string,
  scheduledAt: string,
  reason: string
): Promise<Appointment> {
  const token = sessionStorage.getItem("accessToken");

  const response = await fetch(`${API_URL}/api/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Tenant-Id": TENANT_ID,
    },
    body: JSON.stringify({
      patientId,
      scheduledAtUtc: new Date(scheduledAt).toISOString(),
      reason: reason.trim(),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      errorBody || `Unable to create appointment (${response.status}).`
    );
  }

  return response.json();
}
