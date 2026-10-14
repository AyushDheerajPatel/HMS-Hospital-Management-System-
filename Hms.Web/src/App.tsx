import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  CalendarDays,
  CalendarClock,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getDashboardStats,
  getAppointments,
  getAppointmentDoctors,
  getAvailableAppointmentSlots,
  getPatients,
  login,
  createHospitalConnection,
  logout,
  logoutAllDevices,
  registerAccount,
  registerTenant,
  updateAppointment,
  changeAppointmentStatus,
  setDoctorAvailability,
  synchronizeAppointment,
  validateSession,
  ApiError,
  type Appointment,
  type AppointmentDoctor,
  type DashboardStats,
  type Patient,
  type TenantAccess,
  type TenantRegistration,
} from "./api";
import {
  addAppointment,
  getAppointments as getOfflineAppointments,
  getPatients as getOfflinePatients,
  removeAppointment,
  removeTenantData,
  saveAppointment,
  savePatients,
  type CachedPatient,
  type OfflineAppointment,
} from "./offlineStore";
import {
  getSyncRetryDelayMs,
  isRetryableSyncError,
  isRetryableSyncStatus,
  isOperationOwnedBySession,
} from "./offlineSync";
import { CreatePatientDialog } from "./components/CreatePatientDialog";
import { ClinicalRecordsPage } from "./components/ClinicalRecordsPage";
import { HospitalStaffSettings } from "./components/HospitalStaffSettings";
import { PatientDetailsSheet } from "./components/PatientDetailsSheet";

type Page = "Dashboard" | "Patients" | "Appointments" | "Clinical Records" | "Settings";

function getUtcDateInputValue(daysFromToday = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function readTenants(): TenantAccess[] {
  const value = sessionStorage.getItem("tenantAccess");
  if (!value) return [];
  try {
    return JSON.parse(value) as TenantAccess[];
  } catch {
    sessionStorage.removeItem("tenantAccess");
    return [];
  }
}

function asPatient(patient: CachedPatient): Patient {
  return {
    ...patient,
    dateOfBirth: "",
    phone: null,
    email: null,
    createdAtUtc: "",
  };
}

function isNetworkFailure(error: unknown): boolean {
  return !navigator.onLine || error instanceof TypeError;
}

async function loadAllPatients(tenantId: string): Promise<Patient[]> {
  const allPatients: Patient[] = [];
  let page = 1;
  let totalPages: number;
  do {
    const response = await getPatients("", page, tenantId, 100);
    allPatients.push(...response.items);
    totalPages = response.totalPages;
    page += 1;
  } while (page <= totalPages);

  try {
    await savePatients(tenantId, allPatients);
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent("hms:offline-storage-error", {
        detail:
          error instanceof Error ? error.message : "Offline patient cache write failed.",
      }),
    );
  }
  return allPatients;
}

const syncLocks = new Set<string>();

async function saveQueuedOperation(operation: OfflineAppointment): Promise<void> {
  await saveAppointment(operation);
  window.dispatchEvent(
    new CustomEvent("hms:offline-queue-changed", {
      detail: operation.tenantId,
    }),
  );
}

async function syncTenantAppointments(
  tenantId: string,
  includeRetryableFailures = false,
): Promise<void> {
  const accessToken = sessionStorage.getItem("accessToken");
  if (
    !navigator.onLine ||
    !accessToken ||
    sessionStorage.getItem("activeTenantId") !== tenantId ||
    syncLocks.has(tenantId)
  ) return;
  const activeUserId = sessionStorage.getItem("userId");
  if (!activeUserId) return;

  const sync = async () => {
    if (syncLocks.has(tenantId)) return;
    syncLocks.add(tenantId);
    try {
      const operations = await getOfflineAppointments(tenantId);
      for (const operation of operations) {
        if (
          sessionStorage.getItem("accessToken") !== accessToken ||
          sessionStorage.getItem("userId") !== activeUserId ||
          sessionStorage.getItem("activeTenantId") !== tenantId
        ) {
          break;
        }
        if (operation.tenantId !== tenantId || operation.state === "synced") {
          continue;
        }
        if (!operation.userId) {
          await saveQueuedOperation({
            ...operation,
            state: "failed",
            retryable: false,
            message:
              "This queued appointment has no saved account identity. Sign in with the original account or discard it.",
          });
          continue;
        }
        if (!isOperationOwnedBySession(operation, tenantId, activeUserId)) {
          continue;
        }
        if (operation.state === "failed" && !operation.retryable) continue;
        if (
          operation.nextAttemptAtUtc &&
          Date.parse(operation.nextAttemptAtUtc) > Date.now() &&
          !includeRetryableFailures
        ) continue;

        const operationToSync =
          operation.state === "syncing"
            ? { ...operation, state: "pending" as const }
            : operation;
        await saveQueuedOperation({
          ...operationToSync,
          state: "syncing",
          message: undefined,
        });
        try {
          const appointment = await synchronizeAppointment(
            operationToSync,
            tenantId,
            accessToken,
          );
          await saveQueuedOperation({
            ...operationToSync,
            state: "synced",
            retryable: false,
            retryCount: operationToSync.retryCount,
            syncedAtUtc: new Date().toISOString(),
            serverAppointmentId: appointment.id,
            confirmedAppointment: appointment,
            nextAttemptAtUtc: undefined,
            message: undefined,
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            window.dispatchEvent(new Event("hms:unauthorized"));
            break;
          }
          const retryable =
            isRetryableSyncError(error) ||
            (error instanceof ApiError &&
              isRetryableSyncStatus(error.status));
          const retryDelayMs = getSyncRetryDelayMs(
            operation.retryCount,
            Math.random,
            error instanceof ApiError ? error.retryAfterMs : undefined,
          );
          await saveQueuedOperation({
            ...operationToSync,
            state: retryable ? "pending" : "failed",
            retryable,
            retryCount: operation.retryCount + 1,
            nextAttemptAtUtc: retryable
              ? new Date(Date.now() + retryDelayMs).toISOString()
              : undefined,
            message:
              error instanceof Error
                ? error.message
                : "Unable to synchronize appointment.",
          });
        }
      }
    } finally {
      syncLocks.delete(tenantId);
    }
  };

  if ("locks" in navigator) {
    await navigator.locks.request(
      `hms:appointment-sync:${tenantId}`,
      { ifAvailable: true },
      async (lock) => {
        if (lock) await sync();
      },
    );
    return;
  }
  await sync();
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status.toLowerCase() === "scheduled"
      ? "secondary"
      : status.toLowerCase() === "completed"
        ? "default"
        : "outline";

  return <Badge variant={variant}>{status}</Badge>;
}

function getAppointmentPatientLabel(
  patientId: string,
  patients: Patient[],
): string {
  const patient = patients.find((item) => item.id === patientId);
  return patient
    ? `${patient.firstName} ${patient.lastName}`
    : `Patient ${patientId.slice(0, 8)}`;
}

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [token, setToken] = useState(
    () => sessionStorage.getItem("accessToken") ?? "",
  );
  const [sessionStatus, setSessionStatus] = useState<
    "checking" | "valid" | "unavailable"
  >(() => sessionStorage.getItem("accessToken") ? "checking" : "valid");
  const [userId, setUserId] = useState(
    () => sessionStorage.getItem("userId") ?? "",
  );
  const [sessionCheckAttempt, setSessionCheckAttempt] = useState(0);
  const logoutInProgress = useRef(false);
  const [tenants, setTenants] = useState<TenantAccess[]>(readTenants);
  const [tenantId, setTenantId] = useState(
    () => sessionStorage.getItem("activeTenantId") ?? "",
  );
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [registeringHospital, setRegisteringHospital] = useState(false);
  const [registeringAccount, setRegisteringAccount] = useState(false);
  const [hospitalName, setHospitalName] = useState("");
  const [hospitalSlug, setHospitalSlug] = useState("");
  const [registrationSuccess, setRegistrationSuccess] = useState("");
  const [offlineOperations, setOfflineOperations] = useState<OfflineAppointment[]>([]);
  const [tenantNotice, setTenantNotice] = useState("");
  const [page, setPage] = useState<Page>("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientPage, setPatientPage] = useState(1);
  const [patientTotal, setPatientTotal] = useState(0);
  const [patientTotalPages, setPatientTotalPages] = useState(0);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState("");
  const [patientOfflineNotice, setPatientOfflineNotice] = useState("");
  const [patientCreateNotice, setPatientCreateNotice] = useState("");
  const [patientRetry, setPatientRetry] = useState(0);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentStatus, setAppointmentStatus] = useState("");
  const [appointmentLoading, setAppointmentLoading] = useState(false);
  const [appointmentError, setAppointmentError] = useState("");
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentTotal, setAppointmentTotal] = useState(0);
  const [appointmentTotalPages, setAppointmentTotalPages] = useState(0);
  const [appointmentRetry, setAppointmentRetry] = useState(0);
  const [appointmentDoctors, setAppointmentDoctors] = useState<
    AppointmentDoctor[]
  >([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [doctorError, setDoctorError] = useState("");
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0);
  const [availabilityDate, setAvailabilityDate] = useState(
    () => getUtcDateInputValue(1),
  );
  const [availabilityDoctorId, setAvailabilityDoctorId] = useState("");
  const [availabilityStartTimeUtc, setAvailabilityStartTimeUtc] = useState("");
  const [availabilityEndTimeUtc, setAvailabilityEndTimeUtc] = useState("");
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [savingAvailability, setSavingAvailability] = useState(false);

  const [appointmentPatients, setAppointmentPatients] = useState<Patient[]>([]);
  const [appointmentPatientsLoading, setAppointmentPatientsLoading] =
    useState(false);
  const [appointmentPatientsError, setAppointmentPatientsError] = useState("");
  const [appointmentPatientsRetry, setAppointmentPatientsRetry] = useState(0);
  const [newPatientId, setNewPatientId] = useState("");
  const [newDoctorId, setNewDoctorId] = useState("");
  const [newAppointmentDate, setNewAppointmentDate] = useState(
    () => getUtcDateInputValue(),
  );
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newAppointmentReason, setNewAppointmentReason] = useState("");
  const [creatingAppointment, setCreatingAppointment] = useState(false);
  const [appointmentDialogOpen, setAppointmentDialogOpen] = useState(false);
  const [reschedulingOfflineOperationId, setReschedulingOfflineOperationId] =
    useState<string | null>(null);
  const [createAppointmentMessage, setCreateAppointmentMessage] = useState("");
  const [reschedulingAppointment, setReschedulingAppointment] =
    useState<Appointment | null>(null);
  const [rescheduledAt, setRescheduledAt] = useState("");
  const [editingAppointmentPatientId, setEditingAppointmentPatientId] =
    useState("");
  const [editingAppointmentReason, setEditingAppointmentReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const tenantRole = tenants.find((tenant) => tenant.tenantId === tenantId)
    ?.role.toLowerCase();
  const canConfigureAvailability =
    tenantRole === "admin" || tenantRole === "doctor";

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const controller = new AbortController();

    void validateSession(controller.signal)
      .then((verifiedUserId) => {
        if (!cancelled) {
          sessionStorage.setItem("userId", verifiedUserId);
          setUserId(verifiedUserId);
          setSessionStatus("valid");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          window.dispatchEvent(new Event("hms:unauthorized"));
          return;
        }
        setSessionStatus("unavailable");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [token, sessionCheckAttempt]);

  useEffect(() => {
    if (
      !token ||
      sessionStatus !== "valid" ||
      !tenantId ||
      page !== "Patients"
    ) return;

    let cancelled = false;

    async function loadPatients() {
      setPatientLoading(true);
      setPatientError("");
      try {
        if (!isOnline) {
          throw new TypeError("Offline.");
        }
        const result = await getPatients(patientSearch, patientPage, tenantId);
        if (cancelled) return;
        setPatients(result.items);
        setPatientTotal(result.totalCount);
        setPatientTotalPages(result.totalPages);
        setPatientOfflineNotice("");
        try {
          await savePatients(tenantId, result.items);
        } catch (error) {
          window.dispatchEvent(
            new CustomEvent("hms:offline-storage-error", {
              detail:
                error instanceof Error
                  ? error.message
                  : "Offline patient cache write failed.",
            }),
          );
        }
      } catch (error) {
        if (!cancelled && isNetworkFailure(error)) {
          setIsOnline(false);
          try {
            const cached = (await getOfflinePatients(tenantId))
              .filter((patient) =>
                `${patient.firstName} ${patient.lastName}`
                  .toLowerCase()
                  .includes(patientSearch.trim().toLowerCase()),
              );
            const pageSize = 10;
            setPatients(
              cached
                .slice((patientPage - 1) * pageSize, patientPage * pageSize)
                .map(asPatient),
            );
            setPatientTotal(cached.length);
            setPatientTotalPages(Math.ceil(cached.length / pageSize));
            setPatientOfflineNotice(
              cached.length
                ? "Offline copy: only previously synchronized patient names and status are stored on this device."
                : "",
            );
            setPatientError(
              cached.length ? "" : "No synchronized patient data is available offline.",
            );
          } catch (storageError) {
            setPatientError(
              storageError instanceof Error
                ? storageError.message
                : "Unable to read offline patients.",
            );
          }
        } else if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) {
            window.dispatchEvent(new Event("hms:unauthorized"));
          }
          setPatientError(
            error instanceof Error ? error.message : "Unable to load patients.",
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
  }, [
    token,
    sessionStatus,
    tenantId,
    page,
    patientSearch,
    patientPage,
    patientRetry,
    isOnline,
  ]);

  useEffect(() => {
    if (
      !token ||
      sessionStatus !== "valid" ||
      !tenantId ||
      page !== "Appointments"
    ) return;
    if (!isOnline) return;

    let cancelled = false;
    async function loadDoctors() {
      setDoctorsLoading(true);
      setDoctorError("");
      try {
        const doctors = await getAppointmentDoctors(tenantId);
        if (!cancelled) {
          setAppointmentDoctors(doctors);
          if (tenantRole === "doctor" && doctors.some(
            (doctor) => doctor.id === userId,
          )) {
            setAvailabilityDoctorId(userId);
          }
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          window.dispatchEvent(new Event("hms:unauthorized"));
        }
        setDoctorError(
          error instanceof Error ? error.message : "Unable to load doctors.",
        );
      } finally {
        if (!cancelled) setDoctorsLoading(false);
      }
    }
    void loadDoctors();
    return () => {
      cancelled = true;
    };
  }, [token, sessionStatus, tenantId, page, isOnline, tenantRole, userId]);

  useEffect(() => {
    if (
      !token ||
      sessionStatus !== "valid" ||
      !tenantId ||
      page !== "Appointments" ||
      !newDoctorId ||
      !newAppointmentDate
    ) return;
    if (!isOnline) return;

    let cancelled = false;
    async function loadSlots() {
      setSlotsLoading(true);
      setSlotsError("");
      setAvailableSlots([]);
      setNewScheduledAt("");
      try {
        const slots = await getAvailableAppointmentSlots(
          newDoctorId,
          newAppointmentDate,
          tenantId,
        );
        if (cancelled) return;
        setAvailableSlots(slots);
        if (slots.length === 0) {
          setSlotsError("No available appointment slots for this date.");
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          window.dispatchEvent(new Event("hms:unauthorized"));
        }
        setSlotsError(
          error instanceof Error
            ? error.message
            : "Unable to load appointment availability.",
        );
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    }
    void loadSlots();
    return () => {
      cancelled = true;
    };
  }, [
    token,
    sessionStatus,
    tenantId,
    page,
    newDoctorId,
    newAppointmentDate,
    isOnline,
    availabilityRefresh,
  ]);

  useEffect(() => {
    if (
      !token ||
      sessionStatus !== "valid" ||
      !tenantId ||
      (page !== "Appointments" && page !== "Clinical Records")
    ) return;

    let cancelled = false;

    async function loadAppointments() {
      setAppointmentLoading(true);
      setAppointmentError("");
      try {
        if (!isOnline) {
          throw new TypeError("Offline.");
        }
        const result = await getAppointments(
          appointmentStatus,
          appointmentPage,
          tenantId,
        );
        if (cancelled) return;
        setAppointments(result.items);
        setAppointmentTotal(result.totalCount);
        setAppointmentTotalPages(result.totalPages);
      } catch (error) {
        if (!cancelled && isNetworkFailure(error)) {
          setIsOnline(false);
          setAppointmentError(
            "Existing appointments are unavailable offline. New appointments can be queued.",
          );
        } else if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) {
            window.dispatchEvent(new Event("hms:unauthorized"));
          }
          setAppointmentError(
            error instanceof Error
              ? error.message
              : "Unable to load appointments.",
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
  }, [
    token,
    sessionStatus,
    tenantId,
    page,
    appointmentStatus,
    appointmentPage,
    appointmentRetry,
    isOnline,
  ]);

  useEffect(() => {
    if (
      !token ||
      sessionStatus !== "valid" ||
      !tenantId ||
      (page !== "Appointments" && page !== "Clinical Records")
    ) return;

    let cancelled = false;

    async function loadAppointmentPatients() {
      setAppointmentPatientsLoading(true);
      setAppointmentPatientsError("");
      try {
        if (isOnline) {
          const patients = await loadAllPatients(tenantId);
          if (!cancelled) setAppointmentPatients(patients);
        } else {
          const patients = await getOfflinePatients(tenantId);
          if (!cancelled) {
            setAppointmentPatients(patients.map(asPatient));
            if (patients.length === 0) {
              setAppointmentPatientsError(
                "No synchronized patients are available offline.",
              );
            } else if (page === "Clinical Records") {
              setAppointmentPatientsError(
                "Clinical records require an online connection.",
              );
            }
          }
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          window.dispatchEvent(new Event("hms:unauthorized"));
        }
        if (!cancelled && isNetworkFailure(error)) {
          setIsOnline(false);
          try {
            const patients = await getOfflinePatients(tenantId);
            if (cancelled) return;
            setAppointmentPatients(patients.map(asPatient));
            if (patients.length === 0) {
              setAppointmentPatientsError(
                "No synchronized patients are available offline.",
              );
            } else if (page === "Clinical Records") {
              setAppointmentPatientsError(
                "Clinical records require an online connection.",
              );
            }
          } catch (storageError) {
            if (cancelled) return;
            setAppointmentPatientsError(
              storageError instanceof Error
                ? storageError.message
                : "Unable to load patients for this hospital.",
            );
          }
        } else if (!cancelled) {
          setAppointmentPatientsError(
            error instanceof Error
              ? error.message
              : "Unable to load patients for this hospital.",
          );
        }
      } finally {
        if (!cancelled) setAppointmentPatientsLoading(false);
      }
    }

    void loadAppointmentPatients();
    return () => {
      cancelled = true;
    };
  }, [token, sessionStatus, tenantId, page, isOnline, appointmentPatientsRetry]);

  useEffect(() => {
    if (
      !token ||
      sessionStatus !== "valid" ||
      !tenantId ||
      page !== "Patients" ||
      !isOnline
    ) return;
    let cancelled = false;
    void loadAllPatients(tenantId).catch((error: unknown) => {
      if (!cancelled && isNetworkFailure(error)) {
        setIsOnline(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, sessionStatus, tenantId, page, isOnline]);

  useEffect(() => {
    if (
      !token ||
      sessionStatus !== "valid" ||
      !tenantId ||
      page !== "Dashboard" ||
      !isOnline
    ) return;

    let cancelled = false;
    void getDashboardStats(tenantId)
      .then((value) => {
        if (cancelled) return;
        setStats(value);
        setPatientTotal(value.patientCount);
        setAppointmentTotal(value.upcomingAppointmentCount);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) {
            window.dispatchEvent(new Event("hms:unauthorized"));
          }
          setAppointmentError(
            error instanceof Error ? error.message : "Unable to load dashboard.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    token,
    sessionStatus,
    tenantId,
    page,
    isOnline,
    patientRetry,
    appointmentRetry,
  ]);

  useEffect(() => {
    const setOnline = () => setIsOnline(true);
    const setOffline = () => setIsOnline(false);
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
    };
  }, []);

  useEffect(() => {
    if (!token || sessionStatus !== "valid" || !tenantId) return;
    let cancelled = false;
    async function refreshAndSync() {
      const operations = await getOfflineAppointments(tenantId);
      if (cancelled) return;
      setOfflineOperations(operations);
      if (isOnline) {
        await syncTenantAppointments(tenantId);
        if (!cancelled) {
          setOfflineOperations(await getOfflineAppointments(tenantId));
        }
      }
    }
    void refreshAndSync().catch((error: unknown) => {
      if (!cancelled) {
        setCreateAppointmentMessage(
          error instanceof Error ? error.message : "Unable to read offline queue.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, sessionStatus, tenantId, isOnline]);

  useEffect(() => {
    if (!token || sessionStatus !== "valid" || !tenantId || !isOnline) return;
    const nextRetry = offlineOperations
      .filter(
        (operation) =>
            (operation.state === "pending" || operation.state === "failed") &&
          operation.retryable &&
          operation.userId === userId &&
          operation.nextAttemptAtUtc,
      )
      .map((operation) => Date.parse(operation.nextAttemptAtUtc!))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    if (nextRetry === undefined) return;

    const timer = window.setTimeout(
      () => void syncTenantAppointments(tenantId),
      Math.max(0, nextRetry - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [token, sessionStatus, tenantId, userId, isOnline, offlineOperations]);

  useEffect(() => {
    const onUnauthorized = () => {
      if (logoutInProgress.current) return;
      logoutInProgress.current = true;
      const expireSession = async () => {
        let localDataWarning = "";
        if (tenantId) {
          try {
            await removeTenantData(tenantId);
          } catch (error) {
            localDataWarning = error instanceof Error
              ? `The expired session's local data could not be cleared automatically: ${error.message}`
              : "The expired session's local data could not be cleared automatically.";
          }
        }
        sessionStorage.removeItem("accessToken");
        sessionStorage.removeItem("tenantAccess");
        sessionStorage.removeItem("activeTenantId");
        sessionStorage.removeItem("userId");
        setToken("");
        setUserId("");
        setTenantId("");
        setTenants([]);
        setOfflineOperations([]);
        setPatients([]);
        setAppointments([]);
        setAppointmentPatients([]);
        setStats(null);
        setPassword("");
        setMessage(
          localDataWarning
            ? `Session expired. Please sign in again. ${localDataWarning}`
            : "Session expired. Please sign in again.",
        );
      };
      void expireSession();
    };
    window.addEventListener("hms:unauthorized", onUnauthorized);
    return () => window.removeEventListener("hms:unauthorized", onUnauthorized);
  }, [tenantId]);

  useEffect(() => {
    const onStorageError = (event: Event) =>
      setPatientOfflineNotice(
        `Offline storage is unavailable. Data still loads online, but will not be available on this device offline. ${
          (event as CustomEvent<string>).detail ?? ""
        }`,
      );
    window.addEventListener("hms:offline-storage-error", onStorageError);
    return () =>
      window.removeEventListener("hms:offline-storage-error", onStorageError);
  }, []);

  useEffect(() => {
    if (!token || sessionStatus !== "valid" || !tenantId || !isOnline) return;

    let disposed = false;
    let connection: Awaited<ReturnType<typeof createHospitalConnection>> | undefined;

    const connect = async () => {
      try {
        connection = await createHospitalConnection(tenantId, () => {
          if (page === "Appointments") {
            setAppointmentRetry((current) => current + 1);
            setAvailabilityRefresh((current) => current + 1);
          }
          if (page === "Dashboard") {
            setPatientRetry((current) => current + 1);
          }
        });
      } catch (error) {
        if (disposed) return;
        if (error instanceof ApiError && error.status === 401) {
          window.dispatchEvent(new Event("hms:unauthorized"));
          return;
        }
        setAppointmentError(
          error instanceof Error
            ? `Live appointment updates disconnected: ${error.message}`
            : "Live appointment updates disconnected.",
        );
      }
    };

    void connect();
    return () => {
      disposed = true;
      void connection?.stop().catch(() => undefined);
    };
  }, [token, sessionStatus, tenantId, isOnline, page]);

  useEffect(() => {
    const onQueueChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== tenantId || !tenantId) return;
      void getOfflineAppointments(tenantId).then(setOfflineOperations).catch((error: unknown) => {
        setCreateAppointmentMessage(
          error instanceof Error ? error.message : "Unable to refresh synchronization status.",
        );
      });
    };
    window.addEventListener("hms:offline-queue-changed", onQueueChanged);
    return () =>
      window.removeEventListener("hms:offline-queue-changed", onQueueChanged);
  }, [tenantId]);

  useEffect(() => {
    const onServiceWorkerError = () =>
      setTenantNotice(
        "Offline application startup could not be enabled in this browser. Keep this tab open while offline.",
      );
    window.addEventListener("hms:service-worker-error", onServiceWorkerError);
    return () =>
      window.removeEventListener(
        "hms:service-worker-error",
        onServiceWorkerError,
      );
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginLoading(true);
    setMessage("");

    try {
      const result = await login(email, password);
      if (!result.accessToken) {
        throw new Error("Login response did not contain a token.");
      }
      setSessionStatus("checking");
      sessionStorage.setItem("accessToken", result.accessToken);
      sessionStorage.setItem("userId", result.userId);
      logoutInProgress.current = false;
      sessionStorage.setItem("tenantAccess", JSON.stringify(result.tenants));
      setToken(result.accessToken);
      setUserId(result.userId);
      setTenants(result.tenants);
      const selectedTenant = result.tenants[0]?.tenantId ?? "";
      sessionStorage.setItem("activeTenantId", selectedTenant);
      setTenantId(selectedTenant);
      setTenantNotice("");
      setPatientOfflineNotice("");
      setPatients([]);
      setAppointments([]);
      setAppointmentPatients([]);
      setStats(null);
      setOfflineOperations([]);
      if (result.tenants.length === 0) {
        setMessage(
          "This account is not a member of a hospital. Register a hospital or contact its administrator.",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegisterTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginLoading(true);
    setMessage("");
    setRegistrationSuccess("");
    let registeredTenant: TenantRegistration | null = null;
    try {
      registeredTenant = await registerTenant(
        hospitalName,
        hospitalSlug,
        email,
        password,
      );
      const signInResult = await login(email, password);
      const registeredHospital = signInResult.tenants.find(
        (tenant) => tenant.tenantId === registeredTenant?.tenantId,
      );
      if (!registeredHospital) {
        throw new Error(
          "Hospital created, but the administrator membership was not returned. Sign in again or contact support.",
        );
      }
      setSessionStatus("checking");
      sessionStorage.setItem("accessToken", signInResult.accessToken);
      sessionStorage.setItem("userId", signInResult.userId);
      logoutInProgress.current = false;
      sessionStorage.setItem(
        "tenantAccess",
        JSON.stringify(signInResult.tenants),
      );
      sessionStorage.setItem("activeTenantId", registeredHospital.tenantId);
      setToken(signInResult.accessToken);
      setUserId(signInResult.userId);
      setTenants(signInResult.tenants);
      setTenantId(registeredHospital.tenantId);
      setPage("Dashboard");
      setPatients([]);
      setAppointments([]);
      setAppointmentPatients([]);
      setStats(null);
      setOfflineOperations([]);
      setRegisteringHospital(false);
      setEmail(registeredTenant.administratorEmail);
      setPassword("");
      setRegistrationSuccess(
        `${registeredTenant.name} is registered. You are signed in as its administrator.`,
      );
    } catch (error) {
      setRegisteringHospital(false);
      setPassword("");
      if (registeredTenant) {
        setEmail(registeredTenant.administratorEmail);
        setRegistrationSuccess(
          `${registeredTenant.name} was created with an administrator membership. Automatic sign-in failed; sign in with your administrator account to continue.`,
        );
        setMessage(
          error instanceof Error ? error.message : "Automatic sign-in failed.",
        );
      } else {
        setMessage(
          error instanceof Error ? error.message : "Hospital registration failed.",
        );
      }
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegisterAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginLoading(true);
    setMessage("");
    setRegistrationSuccess("");
    try {
      await registerAccount(email, password);
      setPassword("");
      setRegisteringAccount(false);
      setRegistrationSuccess(
        "Account created, but it is not connected to a hospital yet. For privacy, a hospital administrator must add this account in Hospital Staff settings. Sign in again after they add you.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Account registration failed.",
      );
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleCreateAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !userId ||
      !tenantId ||
      !newPatientId ||
      !newDoctorId ||
      !newScheduledAt ||
      !newAppointmentReason.trim()
    ) {
      setCreateAppointmentMessage(
        "Patient, doctor, available time, and reason are required.",
      );
      return;
    }
    const scheduledAtUtc = new Date(newScheduledAt);
    if (!Number.isFinite(scheduledAtUtc.getTime())) {
      setCreateAppointmentMessage("Enter a valid appointment date and time.");
      return;
    }
    setCreatingAppointment(true);
    setCreateAppointmentMessage("");

    const operationId = crypto.randomUUID();
    const operation: OfflineAppointment = {
      operationId,
      tenantId,
      userId,
      patientId: newPatientId,
      doctorId: newDoctorId,
      scheduledAtUtc: scheduledAtUtc.toISOString(),
      reason: newAppointmentReason.trim(),
      state: "pending",
      retryable: true,
      retryCount: 0,
    };
    let savedLocally = false;
    try {
      await addAppointment(operation);
      savedLocally = true;
      if (reschedulingOfflineOperationId) {
        await removeAppointment(reschedulingOfflineOperationId);
        setReschedulingOfflineOperationId(null);
      }
      setOfflineOperations(await getOfflineAppointments(tenantId));
      if (!isOnline) {
        setCreateAppointmentMessage(
          "Appointment is pending synchronization. It is not booked until the server confirms it.",
        );
        setAppointmentDialogOpen(false);
        setNewPatientId("");
        setNewDoctorId("");
        setNewScheduledAt("");
        setNewAppointmentReason("");
        return;
      }
      await syncTenantAppointments(tenantId, true);
      const updatedOperations = await getOfflineAppointments(tenantId);
      setOfflineOperations(updatedOperations);
      const synchronized = updatedOperations.find(
        (queued) => queued.operationId === operationId,
      );
      setCreateAppointmentMessage(
        synchronized?.state === "synced"
          ? "Appointment created successfully."
          : synchronized?.state === "failed" && !synchronized.retryable
            ? `The appointment could not be booked. ${synchronized.message ?? "Review the synchronization error and choose another available slot."}`
            : "Appointment is pending synchronization. It is not booked until the server confirms it.",
      );
      setAppointmentDialogOpen(false);
      setNewPatientId("");
      setNewDoctorId("");
      setNewScheduledAt("");
      setNewAppointmentReason("");
      setAppointmentPage(1);
      setAppointmentRetry((current) => current + 1);
      setAvailabilityRefresh((current) => current + 1);
      setNewAppointmentDate(getUtcDateInputValue());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      if (
        savedLocally &&
        (error instanceof TypeError || !navigator.onLine)
      ) {
        setIsOnline(false);
        setCreateAppointmentMessage(
          "Appointment is pending synchronization. It is not booked until the server confirms it.",
        );
        setAppointmentDialogOpen(false);
        setNewPatientId("");
        setNewDoctorId("");
        setNewScheduledAt("");
        setNewAppointmentReason("");
        return;
      }
      setCreateAppointmentMessage(
        error instanceof Error
          ? error.message
          : "Unable to create appointment.",
      );
    } finally {
      setCreatingAppointment(false);
    }
  }

  async function handleSetAvailability(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (
      !tenantId ||
      !availabilityDoctorId ||
      !availabilityDate ||
      !availabilityStartTimeUtc ||
      !availabilityEndTimeUtc
    ) {
      setAvailabilityMessage(
        "Select a doctor, date, and UTC start/end times.",
      );
      return;
    }

    setSavingAvailability(true);
    setAvailabilityMessage("");
    try {
      const availability = await setDoctorAvailability(
        {
          doctorId: availabilityDoctorId,
          date: availabilityDate,
          startTimeUtc: availabilityStartTimeUtc,
          endTimeUtc: availabilityEndTimeUtc,
        },
        tenantId,
      );
      setAvailabilityMessage(
        `Availability saved for ${availability.date} (UTC).`,
      );
      setAvailabilityRefresh((current) => current + 1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setAvailabilityMessage(
        error instanceof Error
          ? error.message
          : "Unable to save doctor availability.",
      );
    } finally {
      setSavingAvailability(false);
    }
  }

  async function handleLogout(revokeAllDevices = false) {
    if (logoutInProgress.current) return;
    logoutInProgress.current = true;
    let logoutWarning = "";
    if (tenantId) {
      try {
        const operations = await getOfflineAppointments(tenantId);
        const pendingCount = operations.filter(
          (operation) =>
            operation.state !== "synced" &&
            operation.userId === userId,
        ).length;
        if (
          pendingCount > 0 &&
          !window.confirm(
            `${pendingCount} appointment operation(s) have not synchronized. Signing out will discard this account's queued operations; queues saved under other accounts are preserved. Continue?`,
          )
        ) {
          logoutInProgress.current = false;
          return;
        }
        await removeTenantData(tenantId, userId, true);
      } catch (error) {
        logoutWarning =
          error instanceof Error
            ? `Local hospital data could not be cleared: ${error.message}`
            : "Local hospital data could not be cleared.";
      }
    }
    try {
      if (revokeAllDevices) {
        await logoutAllDevices();
      } else {
        await logout();
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        logoutWarning = [
          logoutWarning,
          error instanceof Error
            ? `Signed out on this device, but server revocation could not be confirmed: ${error.message}`
            : "Signed out on this device, but server revocation could not be confirmed.",
        ].filter(Boolean).join(" ");
      }
    }
    sessionStorage.removeItem("accessToken");
    sessionStorage.removeItem("tenantAccess");
    sessionStorage.removeItem("activeTenantId");
    sessionStorage.removeItem("userId");
    setToken("");
    setUserId("");
    setTenantId("");
    setTenants([]);
    setOfflineOperations([]);
    setPatients([]);
    setAppointments([]);
    setAppointmentPatients([]);
    setStats(null);
    setPassword("");
    setMessage(logoutWarning);
    setTenantNotice(logoutWarning);
    setPage("Dashboard");
  }

  async function handleTenantChange(nextTenantId: string) {
    if (!nextTenantId || nextTenantId === tenantId) return;
    const pending = await getOfflineAppointments(tenantId);
    if (
      pending.some(
        (operation) =>
          operation.userId === userId && operation.state !== "synced",
      )
    ) {
      setTenantNotice(
        "Synchronize or discard pending appointment operations before switching hospitals.",
      );
      return;
    }
    try {
      await removeTenantData(tenantId);
      sessionStorage.setItem("activeTenantId", nextTenantId);
      setTenantId(nextTenantId);
      setTenantNotice("");
      setPatientOfflineNotice("");
      setPatientPage(1);
      setAppointmentPage(1);
      setPatients([]);
      setAppointmentPatients([]);
      setOfflineOperations([]);
    } catch (error) {
      setTenantNotice(
        error instanceof Error
          ? `Unable to clear previous hospital data: ${error.message}`
          : "Unable to clear previous hospital data.",
      );
    }
  }

  async function retryAppointmentSync() {
    if (!tenantId || !isOnline) return;
    try {
      await syncTenantAppointments(tenantId, true);
      setOfflineOperations(await getOfflineAppointments(tenantId));
      setAppointmentRetry((current) => current + 1);
      setAvailabilityRefresh((current) => current + 1);
    } catch (error) {
      setCreateAppointmentMessage(
        error instanceof Error ? error.message : "Unable to retry synchronization.",
      );
    }
  }

  async function handleRescheduleAppointment(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (
      !tenantId ||
      !reschedulingAppointment ||
      !rescheduledAt ||
      !editingAppointmentPatientId ||
      !editingAppointmentReason.trim()
    ) return;
    setRescheduling(true);
    setCreateAppointmentMessage("");
    try {
      await updateAppointment(
        reschedulingAppointment.id,
        editingAppointmentPatientId,
        rescheduledAt,
        editingAppointmentReason,
        reschedulingAppointment.version,
        tenantId,
      );
      setReschedulingAppointment(null);
      setRescheduledAt("");
      setCreateAppointmentMessage("Appointment rescheduled successfully.");
      setAppointmentRetry((current) => current + 1);
      setAvailabilityRefresh((current) => current + 1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setCreateAppointmentMessage(
        error instanceof ApiError && error.status === 409
          ? "This appointment changed since it was loaded. The latest schedule will refresh; review it and try again."
          : error instanceof Error
            ? error.message
            : "Unable to reschedule appointment.",
      );
      if (error instanceof ApiError && error.status === 409) {
        setAppointmentRetry((current) => current + 1);
        setAvailabilityRefresh((current) => current + 1);
        setReschedulingAppointment(null);
      }
    } finally {
      setRescheduling(false);
    }
  }

  async function updateAppointmentStatus(
    appointment: Appointment,
    status: "cancelled" | "completed",
  ) {
    if (!tenantId) return;
    setCreateAppointmentMessage("");
    try {
      await changeAppointmentStatus(
        appointment.id,
        status,
        appointment.version,
        tenantId,
      );
      setCreateAppointmentMessage(
        `Appointment ${status === "cancelled" ? "cancelled" : "marked complete"}.`,
      );
      setAppointmentRetry((current) => current + 1);
      setAvailabilityRefresh((current) => current + 1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setCreateAppointmentMessage(
        error instanceof ApiError && error.status === 409
          ? "This appointment changed since it was loaded. The latest status will refresh."
          : error instanceof Error
            ? error.message
            : "Unable to update appointment status.",
      );
      setAppointmentRetry((current) => current + 1);
      setAvailabilityRefresh((current) => current + 1);
    }
  }

  if (token && sessionStatus !== "valid") {
    const checking = sessionStatus === "checking";
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md border-0 shadow-xl shadow-primary/5 ring-1 ring-border/70">
          <CardHeader className="items-center px-8 pt-8 text-center">
            <CardTitle className="text-2xl tracking-tight">
              {checking ? "Verifying your sign-in" : "Unable to verify your sign-in"}
            </CardTitle>
            <CardDescription>
              {checking
                ? "Please wait while HMS checks your active session."
                : "The authentication service is unavailable. Your saved sign-in has not been cleared."}
            </CardDescription>
          </CardHeader>
          {!checking && (
            <CardContent className="px-8 pb-8">
              <Button
                className="w-full"
                onClick={() => {
                  setSessionStatus("checking");
                  setSessionCheckAttempt((attempt) => attempt + 1);
                }}
              >
                Retry verification
              </Button>
            </CardContent>
          )}
        </Card>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md border-0 shadow-xl shadow-primary/5 ring-1 ring-border/70">
          <CardHeader className="items-center px-8 pt-8 text-center">
            <div className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Activity size={28} />
            </div>
            <CardTitle className="text-2xl tracking-tight">Hospital Management System</CardTitle>
            <CardDescription>
              {registeringHospital
                ? "Set up your hospital workspace"
                : registeringAccount
                  ? "Create a secure HMS staff account"
                  : "Secure care coordination for your hospital team"}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            <form
              onSubmit={
                registeringHospital
                  ? handleRegisterTenant
                  : registeringAccount
                    ? handleRegisterAccount
                    : handleLogin
              }
              className="space-y-5"
            >
              {registeringHospital && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="hospital-name">Hospital name</Label>
                    <Input
                      id="hospital-name"
                      value={hospitalName}
                      onChange={(event) => setHospitalName(event.target.value)}
                      maxLength={200}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hospital-slug">Hospital URL name</Label>
                    <Input
                      id="hospital-slug"
                      value={hospitalSlug}
                      onChange={(event) => setHospitalSlug(event.target.value)}
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      maxLength={100}
                      required
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">
                  {registeringHospital ? "Administrator email" : "Email"}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="administrator@hospital.example"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={registeringHospital || registeringAccount ? 8 : undefined}
                  maxLength={128}
                  required
                />
              </div>
              {registeringHospital && (
                <p className="text-sm text-muted-foreground">
                  This creates a hospital and connects your account as its
                  administrator. You will be signed in after registration.
                </p>
              )}
              {registeringAccount && (
                <p className="text-sm text-muted-foreground">
                  Staff registration creates an account only. A hospital
                  administrator must add it to their hospital before it can
                  access hospital data.
                </p>
              )}
              {message && (
                <p className="text-sm text-destructive" role="alert">
                  {message}
                </p>
              )}
              {registrationSuccess && (
                <p className="text-sm text-green-700" role="status">
                  {registrationSuccess}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={loginLoading}
              >
                {loginLoading
                  ? registeringHospital
                    ? "Registering..."
                    : registeringAccount
                      ? "Creating account..."
                      : "Signing in..."
                  : registeringHospital
                    ? "Register hospital"
                    : registeringAccount
                      ? "Create account"
                      : "Sign in"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setRegisteringHospital((current) => !current);
                  setRegisteringAccount(false);
                  setMessage("");
                }}
              >
                {registeringHospital
                  ? "Already registered? Sign in"
                  : "Register a hospital"}
              </Button>
              {!registeringHospital && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setRegisteringAccount((current) => !current);
                    setMessage("");
                    setRegistrationSuccess("");
                  }}
                >
                  {registeringAccount
                    ? "Already have an account? Sign in"
                    : "Register a staff account"}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  const activeRole = tenants.find((tenant) => tenant.tenantId === tenantId)?.role
    .trim()
    .toLowerCase();
  const canManagePatients =
    activeRole === "admin" || activeRole === "receptionist";
  const canManageAppointments =
    activeRole === "admin" ||
    activeRole === "doctor" ||
    activeRole === "receptionist";
  const canManageClinicalRecords =
    activeRole === "admin" || activeRole === "doctor";
  const navigation: { name: Page; icon: typeof LayoutDashboard }[] = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Patients", icon: Users },
    { name: "Appointments", icon: CalendarDays },
    ...(canManageClinicalRecords
      ? [{ name: "Clinical Records" as const, icon: FileText }]
      : []),
    ...(activeRole === "admin"
      ? [{ name: "Settings" as const, icon: Settings }]
      : []),
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={`flex shrink-0 flex-col border-r bg-card p-3 transition-all ${
          sidebarOpen ? "w-64" : "w-20"
        }`}
      >
        <div className="flex h-14 items-center gap-3 px-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Activity size={24} />
          </div>
          {sidebarOpen && (
            <span className="font-semibold">
              {tenants.find((tenant) => tenant.tenantId === tenantId)?.name ??
                "Hospital"}
            </span>
          )}
        </div>
        <Separator className="my-3" />
        {sidebarOpen && (
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </p>
        )}
        <nav className="flex flex-1 flex-col gap-2">
          {navigation.map(({ name, icon: Icon }) => (
            <Tooltip key={name}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={page === name ? "secondary" : "ghost"}
                    className={`w-full justify-start ${
                      sidebarOpen ? "" : "justify-center px-0"
                    }`}
                    onClick={() => setPage(name)}
                    aria-label={name}
                  >
                    <Icon size={18} />
                    {sidebarOpen && <span>{name}</span>}
                  </Button>
                }
              />
              {!sidebarOpen && <TooltipContent side="right">{name}</TooltipContent>}
            </Tooltip>
          ))}
        </nav>
        <Separator className="my-3" />
        <Button
          type="button"
          variant="ghost"
          className={`justify-start text-destructive hover:text-destructive ${
            sidebarOpen ? "" : "justify-center px-0"
          }`}
          onClick={() => void handleLogout()}
          title="Sign out"
        >
          <LogOut size={18} />
          {sidebarOpen && <span>Sign out</span>}
        </Button>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur sm:px-6">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen((open) => !open)}
                  aria-label="Toggle sidebar"
                >
                  <Menu size={20} />
                </Button>
              }
            />
            <TooltipContent>Toggle sidebar</TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-3">
            <Badge variant={isOnline ? "secondary" : "destructive"}>
              {isOnline ? "Online" : "Offline"}
            </Badge>
            {tenants.length > 1 && (
              <Select value={tenantId} onValueChange={(value) => void handleTenantChange(value ?? "")}>
                <SelectTrigger className="w-48" aria-label="Active hospital">
                  <SelectValue placeholder="Select hospital" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.tenantId} value={tenant.tenantId}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" className="flex items-center gap-3 px-2">
                    <Avatar>
                      <AvatarFallback>AD</AvatarFallback>
                    </Avatar>
                    <span className="hidden text-left sm:block">
                      <span className="block text-sm font-medium">
                        {tenants.find((tenant) => tenant.tenantId === tenantId)?.name ?? "Hospital"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {tenants.find((tenant) => tenant.tenantId === tenantId)?.role ?? "Member"}
                      </span>
                    </span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  {tenants.find((tenant) => tenant.tenantId === tenantId)?.name ?? "Hospital"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void handleLogout()} className="text-destructive focus:text-destructive">
                  <LogOut size={16} /> Sign out
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (window.confirm("Sign out this account from all devices?")) {
                      void handleLogout(true);
                    }
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut size={16} /> Sign out all devices
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <section className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
          {tenantNotice && (
            <p className="text-sm text-destructive" role="alert">{tenantNotice}</p>
          )}
          {patientOfflineNotice && (
            <p className="text-sm text-muted-foreground" role="status">
              {patientOfflineNotice}
            </p>
          )}
          {!tenantId && (
            <p className="text-sm text-destructive" role="alert">
              This account has no hospital membership. Register a hospital or use an account with a tenant membership.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                {tenants.find((tenant) => tenant.tenantId === tenantId)?.name ?? "Hospital"} / Workspace
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{page}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {page === "Dashboard"
                  ? "Here's an overview of your hospital."
                  : page === "Clinical Records"
                    ? "Review and manage patient clinical information."
                    : `Manage your hospital ${page.toLowerCase()}.`}
              </p>
            </div>
            <Badge variant="secondary" className="hidden px-3 py-1 capitalize sm:inline-flex">
              {tenants.find((tenant) => tenant.tenantId === tenantId)?.role ?? "Member"}
            </Badge>
          </div>

          {page === "Dashboard" ? (
            <div className="space-y-6">
              <Card className="overflow-hidden">
                <CardContent className="flex items-center justify-between gap-4 p-6">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      HOSPITAL OVERVIEW
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold">
                      Welcome back!
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Manage patients and appointments from one place.
                    </p>
                  </div>
                  <Activity className="hidden size-12 text-primary sm:block" />
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                      Total Patients
                    </CardTitle>
                    <Users className="size-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {stats?.patientCount ?? patientTotal}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Registered patients
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                      Appointments
                    </CardTitle>
                    <CalendarDays className="size-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {stats?.upcomingAppointmentCount ?? appointmentTotal}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Upcoming appointments
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                      System Status
                    </CardTitle>
                    <Activity className="size-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {isOnline ? "Online" : "Offline"}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isOnline ? "Dashboard is running" : "Dashboard metrics require a connection"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {(patientError || appointmentError) && (
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <p className="text-sm text-destructive" role="alert">
                      {patientError || appointmentError}
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPatientRetry((current) => current + 1);
                        setAppointmentRetry((current) => current + 1);
                      }}
                    >
                      Retry dashboard data
                    </Button>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Quick actions</CardTitle>
                  <CardDescription>
                    Choose a section to continue working.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  <Button onClick={() => setPage("Patients")}>
                    <Users size={18} />
                    View Patients
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPage("Appointments")}
                  >
                    <CalendarDays size={18} />
                    View Appointments
                  </Button>
                  {canManageClinicalRecords && (
                    <Button
                      variant="outline"
                      onClick={() => setPage("Clinical Records")}
                    >
                      <FileText size={18} />
                      Clinical Records
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : page === "Clinical Records" && canManageClinicalRecords ? (
            <ClinicalRecordsPage
              key={tenantId}
              tenantId={tenantId}
              patients={appointmentPatients}
              patientsLoading={appointmentPatientsLoading}
              patientsError={appointmentPatientsError}
              onRetryPatients={() =>
                setAppointmentPatientsRetry((current) => current + 1)
              }
            />
          ) : page === "Patients" ? (
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Patient Directory</CardTitle>
                  <CardDescription>
                    {patientTotal} patient{patientTotal === 1 ? "" : "s"}{" "}
                    registered
                  </CardDescription>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <Input
                    className="w-full sm:max-w-xs"
                    type="search"
                    placeholder="Search name or phone..."
                    value={patientSearch}
                    onChange={(event) => {
                      setPatientSearch(event.target.value);
                      setPatientPage(1);
                    }}
                    aria-label="Search patients"
                  />
                  {canManagePatients && tenantId && (
                    <CreatePatientDialog
                      tenantId={tenantId}
                      onCreated={(patient) => {
                        setPatients((current) => [patient, ...current]);
                        setPatientTotal((current) => current + 1);
                        setPatientSearch("");
                        setPatientPage(1);
                        setPatientRetry((current) => current + 1);
                        setPatientCreateNotice(
                          `Patient ${patient.firstName} ${patient.lastName} created.`,
                        );
                      }}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {patientCreateNotice && (
                  <p className="mb-4 text-sm text-green-700" role="status">
                    {patientCreateNotice}
                  </p>
                )}
                {patientLoading ? (
                  <div className="space-y-3 py-3" aria-label="Loading patients">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <div key={index} className="flex items-center gap-4">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                        <Skeleton className="hidden h-4 w-24 sm:block" />
                      </div>
                    ))}
                  </div>
                ) : patientError ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <p className="text-sm text-destructive" role="alert">
                      {patientError}
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setPatientRetry((current) => current + 1)}
                    >
                      Retry
                    </Button>
                  </div>
                ) : patients.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No patients found.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Patient</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Date of Birth</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead><span className="sr-only">Actions</span></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {patients.map((patient) => (
                          <TableRow key={patient.id}>
                            <TableCell>
                              <div className="font-medium">
                                {patient.firstName} {patient.lastName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                ID: {patient.id.slice(0, 8)}
                              </div>
                            </TableCell>
                            <TableCell>{patient.phone || "Not cached"}</TableCell>
                            <TableCell>{patient.email || "Not cached"}</TableCell>
                            <TableCell>{patient.dateOfBirth || "Not cached"}</TableCell>
                            <TableCell>
                              <StatusBadge status={patient.status} />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedPatient(patient)}
                                aria-label={`View ${patient.firstName} ${patient.lastName} details`}
                              >
                                View details
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {selectedPatient && (
                  <PatientDetailsSheet
                    key={selectedPatient.id}
                    patient={selectedPatient}
                    tenantId={tenantId}
                    onOpenChange={(open) => {
                      if (!open) setSelectedPatient(null);
                    }}
                  />
                )}

                <Separator className="my-4" />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Page {patientPage} of {Math.max(patientTotalPages, 1)}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={patientPage <= 1 || patientLoading}
                      onClick={() => setPatientPage((current) => current - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        patientPage >= patientTotalPages || patientLoading
                      }
                      onClick={() => setPatientPage((current) => current + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : page === "Appointments" ? (
            <div className="space-y-6">
              {offlineOperations.length > 0 && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Appointment synchronization</CardTitle>
                      <CardDescription>
                        Pending appointments are not booked until the server accepts them.
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void retryAppointmentSync()}
                      disabled={
                        !isOnline ||
                        offlineOperations.every(
                          (operation) =>
                            operation.state === "synced" ||
                            operation.userId !== userId ||
                            !operation.retryable,
                        )
                      }
                    >
                      Sync / retry
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {offlineOperations.map((operation) => (
                      <div
                        key={operation.operationId}
                        className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            Appointment for patient {operation.patientId.slice(0, 8)}
                          </p>
                          {operation.userId && operation.userId !== userId && (
                            <p className="text-xs text-amber-700">
                              Saved under another account. Sign in as that account
                              to synchronize this appointment.
                            </p>
                          )}
                          {operation.serverAppointmentId && (
                            <p className="text-xs text-muted-foreground">
                              Server appointment ID: {operation.serverAppointmentId}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {new Date(operation.scheduledAtUtc).toLocaleString()}
                          </p>
                          {operation.message && (
                            <p className="text-xs text-destructive" role="alert">
                              {operation.message}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={
                            operation.userId && operation.userId !== userId
                              ? "outline"
                              : operation.state === "failed"
                              ? "destructive"
                              : operation.state === "synced"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {operation.userId && operation.userId !== userId
                            ? "Other account"
                            : operation.state === "pending"
                            ? "Pending sync"
                            : operation.state === "syncing"
                              ? "Syncing"
                              : operation.state === "synced"
                                ? "Confirmed by server"
                                : operation.retryable
                                  ? "Pending sync · Retry scheduled"
                                  : "Booking failed · Needs review"}
                        </Badge>
                        {operation.state === "synced" &&
                          operation.syncedAtUtc && (
                            <span className="text-xs text-muted-foreground">
                              Confirmed by server{" "}
                              {new Date(operation.syncedAtUtc).toLocaleString()}
                            </span>
                          )}
                        {operation.state === "failed" &&
                          !operation.retryable &&
                          (!operation.userId || operation.userId === userId) && (
                            <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setReschedulingOfflineOperationId(
                                  operation.operationId,
                                );
                                setNewPatientId(operation.patientId);
                                setNewDoctorId(operation.doctorId ?? "");
                                setNewAppointmentDate(
                                  operation.scheduledAtUtc.slice(0, 10),
                                );
                                setNewScheduledAt("");
                                setNewAppointmentReason(operation.reason ?? "");
                                setAppointmentDialogOpen(true);
                              }}
                            >
                              Choose another slot
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    "Discard this unsynchronized appointment? This cannot be undone.",
                                  )
                                ) return;
                                void removeAppointment(operation.operationId)
                                  .then(() =>
                                    getOfflineAppointments(tenantId).then(
                                      setOfflineOperations,
                                    ),
                                  )
                                  .catch((error: unknown) =>
                                    setCreateAppointmentMessage(
                                      error instanceof Error
                                        ? error.message
                                        : "Unable to discard the failed appointment.",
                                    ),
                                  );
                              }}
                            >
                              Discard
                            </Button>
                            </>
                          )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {canConfigureAvailability && (
                <Card>
                  <CardHeader>
                    <CardTitle>Doctor availability</CardTitle>
                    <CardDescription>
                      Configure a UTC availability window for today or a future date.
                      Slots are 30 minutes; no working hours are assumed by default.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="grid gap-4 sm:grid-cols-2"
                      onSubmit={handleSetAvailability}
                    >
                      <div className="space-y-2">
                        <Label htmlFor="availability-doctor">Doctor</Label>
                        <Select
                          value={availabilityDoctorId}
                          onValueChange={(value) =>
                            setAvailabilityDoctorId(value ?? "")
                          }
                        >
                          <SelectTrigger id="availability-doctor" className="w-full">
                            <SelectValue placeholder="Select a doctor" />
                          </SelectTrigger>
                          <SelectContent>
                            {appointmentDoctors.map((doctor) => (
                              <SelectItem key={doctor.id} value={doctor.id}>
                                {doctor.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="availability-date">Date (UTC)</Label>
                        <Input
                          id="availability-date"
                          type="date"
                          min={getUtcDateInputValue()}
                          value={availabilityDate}
                          onChange={(event) =>
                            setAvailabilityDate(event.target.value)
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="availability-start">Start time (UTC)</Label>
                        <Input
                          id="availability-start"
                          type="time"
                          step={1800}
                          value={availabilityStartTimeUtc}
                          onChange={(event) =>
                            setAvailabilityStartTimeUtc(event.target.value)
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="availability-end">End time (UTC)</Label>
                        <Input
                          id="availability-end"
                          type="time"
                          step={1800}
                          value={availabilityEndTimeUtc}
                          onChange={(event) =>
                            setAvailabilityEndTimeUtc(event.target.value)
                          }
                          required
                        />
                      </div>
                      {availabilityMessage && (
                        <p className="text-sm text-muted-foreground sm:col-span-2" role="status">
                          {availabilityMessage}
                        </p>
                      )}
                      <div className="sm:col-span-2">
                        <Button
                          type="submit"
                          disabled={
                            savingAvailability ||
                            !isOnline ||
                            !availabilityDoctorId ||
                            doctorsLoading
                          }
                        >
                          {savingAvailability ? "Saving..." : "Save availability"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Appointments</CardTitle>
                    <CardDescription>
                      {appointmentTotal} appointment(s) found
                    </CardDescription>
                  </div>
                  <div className="w-full sm:max-w-xs">
                    <Label htmlFor="appointment-status" className="sr-only">
                      Filter appointments by status
                    </Label>
                    <Select
                      value={appointmentStatus || "all"}
                      onValueChange={(value) => {
                        setAppointmentStatus(!value || value === "all" ? "" : value);
                        setAppointmentPage(1);
                      }}
                    >
                      <SelectTrigger id="appointment-status" className="w-full">
                        <SelectValue placeholder="Filter by status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  {appointmentLoading ? (
                    <div className="space-y-3 py-3" aria-label="Loading appointments">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="grid grid-cols-4 gap-3">
                          <Skeleton className="h-5 w-full" />
                          <Skeleton className="h-5 w-full" />
                          <Skeleton className="h-5 w-full" />
                          <Skeleton className="h-5 w-2/3" />
                        </div>
                      ))}
                    </div>
                  ) : appointmentError ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <p className="text-sm text-destructive" role="alert">
                        {appointmentError}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() =>
                          setAppointmentRetry((current) => current + 1)
                        }
                      >
                        Retry
                      </Button>
                    </div>
                  ) : appointments.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No appointments found.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Patient</TableHead>
                            <TableHead>Doctor</TableHead>
                            <TableHead>Date &amp; Time</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {appointments.map((appointment) => (
                            <TableRow key={appointment.id}>
                              <TableCell title={appointment.patientId}>
                                <span className="font-medium">
                                  {getAppointmentPatientLabel(
                                    appointment.patientId,
                                    appointmentPatients,
                                  )}
                                </span>
                              </TableCell>
                              <TableCell>
                                {appointmentDoctors.find(
                                  (doctor) =>
                                    doctor.id === appointment.doctorId,
                                )?.email ?? "Unassigned"}
                              </TableCell>
                              <TableCell>
                                {new Date(
                                  appointment.scheduledAtUtc,
                                ).toLocaleString()}
                              </TableCell>
                              <TableCell>{appointment.reason}</TableCell>
                              <TableCell>
                                <StatusBadge status={appointment.status} />
                              </TableCell>
                              <TableCell>
                                {appointment.status.toLowerCase() === "scheduled" &&
                                  canManageAppointments && (
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          setReschedulingAppointment(appointment);
                                          setEditingAppointmentPatientId(appointment.patientId);
                                          setEditingAppointmentReason(appointment.reason);
                                          setNewDoctorId(appointment.doctorId ?? "");
                                          setNewAppointmentDate(
                                            appointment.scheduledAtUtc.slice(0, 10),
                                          );
                                          setAvailableSlots([]);
                                          setRescheduledAt("");
                                        }}
                                      >
                                        <CalendarClock size={16} />
                                        Edit
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          void updateAppointmentStatus(appointment, "completed")
                                        }
                                      >
                                        Complete
                                      </Button>
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => {
                                          if (window.confirm("Cancel this appointment?")) {
                                            void updateAppointmentStatus(appointment, "cancelled");
                                          }
                                        }}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <Separator className="my-4" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Page {appointmentPage} of{" "}
                      {Math.max(appointmentTotalPages, 1)}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        disabled={
                          appointmentPage <= 1 || appointmentLoading
                        }
                        onClick={() =>
                          setAppointmentPage((current) => current - 1)
                        }
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          appointmentPage >= appointmentTotalPages ||
                          appointmentLoading ||
                          appointmentTotalPages === 0
                        }
                        onClick={() =>
                          setAppointmentPage((current) => current + 1)
                        }
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {createAppointmentMessage && !appointmentDialogOpen && (
                  <p className="text-sm text-muted-foreground" role="status">{createAppointmentMessage}</p>
                )}
              <Dialog open={appointmentDialogOpen} onOpenChange={setAppointmentDialogOpen}>
                {canManageAppointments && <div className="flex justify-end">
                  <DialogTrigger
                    render={
                      <Button
                        onClick={() => setReschedulingOfflineOperationId(null)}
                      >
                        <CalendarDays size={18} /> Schedule appointment
                      </Button>
                    }
                  />
                </div>}
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Schedule an Appointment</DialogTitle>
                    <DialogDescription>
                      Add a new appointment for a registered patient.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    className="grid gap-4"
                    onSubmit={handleCreateAppointment}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="appointment-doctor">Doctor</Label>
                      <Select
                        value={newDoctorId}
                        onValueChange={(value) => {
                          setNewDoctorId(value ?? "");
                          setNewScheduledAt("");
                          setAvailableSlots([]);
                        }}
                      >
                        <SelectTrigger id="appointment-doctor" className="w-full">
                          <SelectValue placeholder="Select a doctor" />
                        </SelectTrigger>
                        <SelectContent>
                          {appointmentDoctors.map((doctor) => (
                            <SelectItem key={doctor.id} value={doctor.id}>
                              {doctor.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {doctorsLoading && (
                        <p className="text-xs text-muted-foreground">
                          Loading doctors...
                        </p>
                      )}
                      {!isOnline && appointmentDoctors.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          Doctor choices are unavailable offline.
                        </p>
                      )}
                      {doctorError && (
                        <p className="text-xs text-destructive" role="alert">
                          {doctorError}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="appointment-patient">Patient</Label>
                      <Select
                        value={newPatientId}
                        onValueChange={(value) => setNewPatientId(value ?? "")}
                      >
                        <SelectTrigger id="appointment-patient" className="w-full">
                          <SelectValue placeholder="Select a patient" />
                        </SelectTrigger>
                        <SelectContent>
                          {appointmentPatients.map((patient) => (
                            <SelectItem key={patient.id} value={patient.id}>
                              {patient.firstName} {patient.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="appointment-date">Appointment date (UTC)</Label>
                      <Input
                        id="appointment-date"
                        type="date"
                        value={newAppointmentDate}
                        onChange={(event) => {
                          setNewAppointmentDate(event.target.value);
                          setNewScheduledAt("");
                          setAvailableSlots([]);
                        }}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="appointment-slot">Available time (UTC)</Label>
                      <Select
                        value={newScheduledAt}
                        onValueChange={(value) =>
                          setNewScheduledAt(value ?? "")
                        }
                        disabled={
                          !newDoctorId ||
                          slotsLoading ||
                          availableSlots.length === 0
                        }
                      >
                        <SelectTrigger id="appointment-slot" className="w-full">
                          <SelectValue
                            placeholder={
                              slotsLoading
                                ? "Loading available slots..."
                                : "Select an available time"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {availableSlots.map((slot) => (
                            <SelectItem key={slot} value={slot}>
                              {new Date(slot).toISOString().slice(11, 16)} UTC
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {slotsError && (
                        <p className="text-xs text-muted-foreground" role="status">
                          {slotsError}
                        </p>
                      )}
                      {!isOnline && (
                        <p className="text-xs text-amber-700">
                          {availableSlots.length
                            ? "Showing previously loaded slots. The server must revalidate your choice; offline bookings remain pending."
                            : "Load available slots while online before queuing an appointment offline."}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="appointment-reason">Reason</Label>
                      <Textarea
                        id="appointment-reason"
                        value={newAppointmentReason}
                        onChange={(event) => setNewAppointmentReason(event.target.value)}
                        placeholder="Enter appointment reason"
                        rows={3}
                        required
                      />
                    </div>
                    {createAppointmentMessage && (
                      <p className="text-sm" role="status">{createAppointmentMessage}</p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setAppointmentDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          creatingAppointment ||
                          !newPatientId ||
                          !newDoctorId ||
                          !newScheduledAt
                        }
                      >
                        {creatingAppointment ? "Saving..." : "Create Appointment"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
              <Dialog
                open={reschedulingAppointment !== null}
                onOpenChange={(open) => {
                  if (!open && !rescheduling) {
                    setReschedulingAppointment(null);
                  }
                }}
              >
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Edit appointment</DialogTitle>
                    <DialogDescription>
                      The appointment version is checked when saving so concurrent changes are not overwritten.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    className="grid gap-4"
                    onSubmit={handleRescheduleAppointment}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="rescheduled-date">Date (UTC)</Label>
                      <Input
                        id="rescheduled-date"
                        type="date"
                        value={newAppointmentDate}
                        onChange={(event) => {
                          setNewAppointmentDate(event.target.value);
                          setRescheduledAt("");
                          setAvailableSlots([]);
                        }}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rescheduled-slot">Available time (UTC)</Label>
                      <Select
                        value={rescheduledAt}
                        onValueChange={(value) =>
                          setRescheduledAt(value ?? "")
                        }
                        disabled={slotsLoading || availableSlots.length === 0}
                      >
                        <SelectTrigger id="rescheduled-slot" className="w-full">
                          <SelectValue placeholder="Select an available time" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableSlots.map((slot) => (
                            <SelectItem key={slot} value={slot}>
                              {new Date(slot).toISOString().slice(11, 16)} UTC
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {slotsLoading && (
                        <p className="text-xs text-muted-foreground">
                          Loading available slots...
                        </p>
                      )}
                      {slotsError && (
                        <p className="text-xs text-muted-foreground" role="status">
                          {slotsError}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-appointment-patient">Patient</Label>
                      <Select
                        value={editingAppointmentPatientId}
                        onValueChange={(value) =>
                          setEditingAppointmentPatientId(value ?? "")
                        }
                      >
                        <SelectTrigger id="edit-appointment-patient" className="w-full">
                          <SelectValue placeholder="Select a patient" />
                        </SelectTrigger>
                        <SelectContent>
                          {appointmentPatients.map((patient) => (
                            <SelectItem key={patient.id} value={patient.id}>
                              {patient.firstName} {patient.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-appointment-reason">Reason</Label>
                      <Textarea
                        id="edit-appointment-reason"
                        value={editingAppointmentReason}
                        onChange={(event) =>
                          setEditingAppointmentReason(event.target.value)
                        }
                        maxLength={500}
                        required
                      />
                    </div>
                    {createAppointmentMessage && (
                      <p className="text-sm" role="status">
                        {createAppointmentMessage}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setReschedulingAppointment(null)}
                        disabled={rescheduling}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={rescheduling || !rescheduledAt}
                      >
                        {rescheduling ? "Saving..." : "Save appointment"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
              </div>
            </div>
          ) : page === "Settings" && activeRole === "admin" ? (
            <HospitalStaffSettings key={tenantId} tenantId={tenantId} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Settings</CardTitle>
                <CardDescription>
                  Administrative settings are available to hospital administrators.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
