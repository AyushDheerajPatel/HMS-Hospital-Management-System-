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
  createAppointment,
  getDashboardStats,
  getAppointments,
  getPatients,
  login,
  registerTenant,
  synchronizeAppointment,
  ApiError,
  type Appointment,
  type DashboardStats,
  type Patient,
  type TenantAccess,
} from "./api";
import {
  addAppointment,
  getAppointments as getOfflineAppointments,
  getPatients as getOfflinePatients,
  removeTenantData,
  saveAppointment,
  savePatients,
  type CachedPatient,
  type OfflineAppointment,
} from "./offlineStore";

type Page = "Dashboard" | "Patients" | "Appointments" | "Settings";

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
  if (!navigator.onLine || syncLocks.has(tenantId)) return;
  syncLocks.add(tenantId);
  try {
    const operations = await getOfflineAppointments(tenantId);
    for (const operation of operations) {
      if (operation.state === "synced") {
        continue;
      }
      if (operation.state === "failed" && !operation.retryable) continue;
      if (
        operation.state === "failed" &&
        operation.retryCount >= 5 &&
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
        await synchronizeAppointment(operationToSync, tenantId);
        await saveQueuedOperation({
          operationId: operation.operationId,
          tenantId,
          patientId: operation.patientId,
          scheduledAtUtc: operation.scheduledAtUtc,
          state: "synced",
          retryable: false,
          retryCount: operationToSync.retryCount,
          syncedAtUtc: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          window.dispatchEvent(new Event("hms:unauthorized"));
          break;
        }
        const retryable =
          error instanceof TypeError ||
          (error instanceof ApiError &&
            (error.status === 429 || error.status >= 500));
        await saveQueuedOperation({
          ...operationToSync,
          state: "failed",
          retryable,
          retryCount: operation.retryCount + 1,
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

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [token, setToken] = useState(
    () => sessionStorage.getItem("accessToken") ?? "",
  );
  const [tenants, setTenants] = useState<TenantAccess[]>(readTenants);
  const [tenantId, setTenantId] = useState(
    () => sessionStorage.getItem("activeTenantId") ?? "",
  );
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [registeringHospital, setRegisteringHospital] = useState(false);
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
  const [patientRetry, setPatientRetry] = useState(0);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentStatus, setAppointmentStatus] = useState("");
  const [appointmentLoading, setAppointmentLoading] = useState(false);
  const [appointmentError, setAppointmentError] = useState("");
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentTotal, setAppointmentTotal] = useState(0);
  const [appointmentTotalPages, setAppointmentTotalPages] = useState(0);
  const [appointmentRetry, setAppointmentRetry] = useState(0);

  const [appointmentPatients, setAppointmentPatients] = useState<Patient[]>([]);
  const [newPatientId, setNewPatientId] = useState("");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newAppointmentReason, setNewAppointmentReason] = useState("");
  const [creatingAppointment, setCreatingAppointment] = useState(false);
  const [appointmentDialogOpen, setAppointmentDialogOpen] = useState(false);
  const [createAppointmentMessage, setCreateAppointmentMessage] = useState("");

  useEffect(() => {
    if (!token || !tenantId || page !== "Patients") return;

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
  }, [token, tenantId, page, patientSearch, patientPage, patientRetry, isOnline]);

  useEffect(() => {
    if (!token || !tenantId || page !== "Appointments") return;

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
    tenantId,
    page,
    appointmentStatus,
    appointmentPage,
    appointmentRetry,
    isOnline,
  ]);

  useEffect(() => {
    if (!token || !tenantId || page !== "Appointments") return;

    let cancelled = false;

    async function loadAppointmentPatients() {
      try {
        if (isOnline) {
          const patients = await loadAllPatients(tenantId);
          if (!cancelled) setAppointmentPatients(patients);
        } else {
          const patients = await getOfflinePatients(tenantId);
          if (!cancelled) setAppointmentPatients(patients.map(asPatient));
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          window.dispatchEvent(new Event("hms:unauthorized"));
        }
        if (!cancelled) {
          try {
            const patients = await getOfflinePatients(tenantId);
            setAppointmentPatients(patients.map(asPatient));
            if (patients.length === 0) {
              setCreateAppointmentMessage(
                "No previously synchronized patients are available for offline scheduling.",
              );
            }
          } catch (storageError) {
            setCreateAppointmentMessage(
              storageError instanceof Error
                ? storageError.message
                : "Unable to read patients for offline scheduling.",
            );
          }
        }
      }
    }

    void loadAppointmentPatients();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId, page, isOnline]);

  useEffect(() => {
    if (!token || !tenantId || page !== "Patients" || !isOnline) return;
    let cancelled = false;
    void loadAllPatients(tenantId).catch((error: unknown) => {
      if (!cancelled && isNetworkFailure(error)) {
        setIsOnline(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, tenantId, page, isOnline]);

  useEffect(() => {
    if (!token || !tenantId || page !== "Dashboard" || !isOnline) return;

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
  }, [token, tenantId, page, isOnline, patientRetry, appointmentRetry]);

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
    if (!token || !tenantId) return;
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
  }, [token, tenantId, isOnline]);

  useEffect(() => {
    const onUnauthorized = () => {
      const expireSession = async () => {
        if (tenantId) {
          try {
            await removeTenantData(tenantId);
          } catch {
          setTenantNotice(
            "The expired session's local data could not be cleared automatically. Clear this browser's site data before another user signs in.",
          );
            return;
          }
        }
        sessionStorage.removeItem("accessToken");
        sessionStorage.removeItem("tenantAccess");
        sessionStorage.removeItem("activeTenantId");
        setToken("");
        setTenantId("");
        setTenants([]);
        setOfflineOperations([]);
        setPatients([]);
        setAppointments([]);
        setAppointmentPatients([]);
        setStats(null);
        setPassword("");
        setMessage("Session expired. Please sign in again.");
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
      sessionStorage.setItem("accessToken", result.accessToken);
      sessionStorage.setItem("tenantAccess", JSON.stringify(result.tenants));
      setToken(result.accessToken);
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
    try {
      const result = await registerTenant(
        hospitalName,
        hospitalSlug,
        email,
        password,
      );
      setEmail(result.administratorEmail);
      setPassword("");
      setRegisteringHospital(false);
      setRegistrationSuccess(
        `${result.name} is registered. Sign in with the administrator account to continue.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Hospital registration failed.",
      );
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleCreateAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || !newPatientId || !newScheduledAt || !newAppointmentReason.trim()) {
      setCreateAppointmentMessage("Patient, date/time, and reason are required.");
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
      patientId: newPatientId,
      scheduledAtUtc: scheduledAtUtc.toISOString(),
      reason: newAppointmentReason.trim(),
      state: "pending",
      retryable: true,
      retryCount: 0,
    };
    try {
      if (!isOnline) {
        await addAppointment(operation);
        setOfflineOperations(await getOfflineAppointments(tenantId));
        setCreateAppointmentMessage(
          "Appointment queued on this device. It is not confirmed until synchronization succeeds.",
        );
        setAppointmentDialogOpen(false);
        setNewPatientId("");
        setNewScheduledAt("");
        setNewAppointmentReason("");
        return;
      }
      await createAppointment(
        newPatientId,
        newScheduledAt,
        newAppointmentReason,
        tenantId,
        operationId,
      );
      try {
        await saveQueuedOperation({
          ...operation,
          reason: undefined,
          state: "synced",
          retryable: false,
          syncedAtUtc: new Date().toISOString(),
        });
        setOfflineOperations(await getOfflineAppointments(tenantId));
      } catch (error) {
        window.dispatchEvent(
          new CustomEvent("hms:offline-storage-error", {
            detail:
              error instanceof Error ? error.message : "Unable to save sync receipt.",
          }),
        );
      }
      setCreateAppointmentMessage("Appointment created successfully.");
      setAppointmentDialogOpen(false);
      setNewPatientId("");
      setNewScheduledAt("");
      setNewAppointmentReason("");
      setAppointmentPage(1);
      setAppointmentRetry((current) => current + 1);
    } catch (error) {
      if (isNetworkFailure(error)) {
        if (error instanceof TypeError || !navigator.onLine) {
          setIsOnline(false);
        }
        try {
          await addAppointment(operation);
          setOfflineOperations(await getOfflineAppointments(tenantId));
          setCreateAppointmentMessage(
            "Connection was lost. Appointment queued on this device and is not confirmed until synchronization succeeds.",
          );
          setAppointmentDialogOpen(false);
          setNewPatientId("");
          setNewScheduledAt("");
          setNewAppointmentReason("");
          return;
        } catch (storageError) {
          setCreateAppointmentMessage(
            storageError instanceof Error
              ? storageError.message
              : "Unable to safely queue the appointment offline.",
          );
          return;
        }
      }
      if (error instanceof ApiError && error.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
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

  async function handleLogout(sessionExpired = false) {
    if (tenantId) {
      try {
        const operations = await getOfflineAppointments(tenantId);
        const pendingCount = operations.filter(
          (operation) => operation.state !== "synced",
        ).length;
        if (
          pendingCount > 0 &&
          !sessionExpired &&
          !window.confirm(
            `${pendingCount} appointment operation(s) have not synchronized. Signing out clears their local queue. Continue?`,
          )
        ) {
          return;
        }
        await removeTenantData(tenantId);
      } catch (error) {
        setTenantNotice(
          error instanceof Error
            ? `Unable to clear local hospital data: ${error.message}`
            : "Unable to clear local hospital data.",
        );
        return;
      }
    }
    sessionStorage.removeItem("accessToken");
    sessionStorage.removeItem("tenantAccess");
    sessionStorage.removeItem("activeTenantId");
    setToken("");
    setTenantId("");
    setTenants([]);
    setOfflineOperations([]);
    setPatients([]);
    setAppointments([]);
    setAppointmentPatients([]);
    setStats(null);
    setPassword("");
    setMessage("");
    setTenantNotice("");
    setPage("Dashboard");
  }

  async function handleTenantChange(nextTenantId: string) {
    if (!nextTenantId || nextTenantId === tenantId) return;
    const pending = await getOfflineAppointments(tenantId);
    if (pending.some((operation) => operation.state !== "synced")) {
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
    } catch (error) {
      setCreateAppointmentMessage(
        error instanceof Error ? error.message : "Unable to retry synchronization.",
      );
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Activity size={28} />
            </div>
            <CardTitle className="text-2xl">Hospital Management System</CardTitle>
            <CardDescription>Hospital Management System</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={registeringHospital ? handleRegisterTenant : handleLogin}
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
                  minLength={registeringHospital ? 8 : undefined}
                  maxLength={128}
                  required
                />
              </div>
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
                    : "Signing in..."
                  : registeringHospital
                    ? "Register hospital"
                    : "Sign in"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setRegisteringHospital((current) => !current);
                  setMessage("");
                }}
              >
                {registeringHospital
                  ? "Already registered? Sign in"
                  : "Register a hospital"}
              </Button>
            </form>
          </CardContent>
        </Card>
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
          {sidebarOpen && <span className="font-semibold">City Hospital</span>}
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
        <header className="flex h-16 items-center justify-between border-b bg-card px-4 sm:px-6">
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <section className="space-y-6 p-4 sm:p-6">
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
              <p className="text-sm text-muted-foreground">
                {tenants.find((tenant) => tenant.tenantId === tenantId)?.name ?? "Hospital"} / Workspace
              </p>
              <h1 className="text-3xl font-bold tracking-tight">{page}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {page === "Dashboard"
                  ? "Here's an overview of your hospital."
                  : `Manage your hospital ${page.toLowerCase()}.`}
              </p>
            </div>
            <Badge variant="outline">
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
                </CardContent>
              </Card>
            </div>
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
              </CardHeader>
              <CardContent>
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
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
                        Offline appointments remain unconfirmed until the server accepts them.
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
                            operation.state === "failed"
                              ? "destructive"
                              : operation.state === "synced"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {operation.state}
                        </Badge>
                      </div>
                    ))}
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
                            <TableHead>Patient ID</TableHead>
                            <TableHead>Date &amp; Time</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {appointments.map((appointment) => (
                            <TableRow key={appointment.id}>
                              <TableCell title={appointment.patientId}>
                                {appointment.patientId.slice(0, 8)}...
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
                <div className="flex justify-end">
                  <DialogTrigger
                    render={
                      <Button>
                        <CalendarDays size={18} /> Schedule appointment
                      </Button>
                    }
                  />
                </div>
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
                      <Label htmlFor="appointment-date">Date and time</Label>
                          <Input
                            id="appointment-date"
                            type="datetime-local"
                            value={newScheduledAt}
                            onChange={(event) => setNewScheduledAt(event.target.value)}
                            required
                          />
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
                      <Button type="submit" disabled={creatingAppointment || !newPatientId}>
                        {creatingAppointment ? "Saving..." : "Create Appointment"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
              </div>
            </div>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Settings</CardTitle>
                <CardDescription>
                  Hospital settings will be added later.
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
