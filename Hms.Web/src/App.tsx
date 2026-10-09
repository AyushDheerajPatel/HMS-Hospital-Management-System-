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
  getAppointments,
  getPatients,
  login,
  type Appointment,
  type Patient,
} from "./api";

type Page = "Dashboard" | "Patients" | "Appointments" | "Settings";

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
  const [email, setEmail] = useState("admin@cityhospital.com");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [token, setToken] = useState(
    () => sessionStorage.getItem("accessToken") ?? "",
  );
  const [page, setPage] = useState<Page>("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientPage, setPatientPage] = useState(1);
  const [patientTotal, setPatientTotal] = useState(0);
  const [patientTotalPages, setPatientTotalPages] = useState(0);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState("");
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
    if (!token || (page !== "Patients" && page !== "Dashboard")) return;

    let cancelled = false;

    async function loadPatients() {
      setPatientLoading(true);
      setPatientError("");
      try {
        const result = await getPatients(
          page === "Dashboard" ? "" : patientSearch,
          page === "Dashboard" ? 1 : patientPage,
          10,
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
  }, [token, page, patientSearch, patientPage, patientRetry]);

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
          10,
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
  }, [token, page, appointmentStatus, appointmentPage, appointmentRetry]);

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
            "Unable to load patients for the appointment form.",
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
        newAppointmentReason,
      );
      setCreateAppointmentMessage("Appointment created successfully.");
      setAppointmentDialogOpen(false);
      setNewPatientId("");
      setNewScheduledAt("");
      setNewAppointmentReason("");
      setAppointmentPage(1);
      setAppointmentRetry((current) => current + 1);
    } catch (error) {
      setCreateAppointmentMessage(
        error instanceof Error
          ? error.message
          : "Unable to create appointment.",
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
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Activity size={28} />
            </div>
            <CardTitle className="text-2xl">City Hospital</CardTitle>
            <CardDescription>Hospital Management System</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@cityhospital.com"
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
                  required
                />
              </div>
              {message && (
                <p className="text-sm text-destructive" role="alert">
                  {message}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={loginLoading}
              >
                {loginLoading ? "Signing in..." : "Sign in"}
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
          onClick={handleLogout}
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
            <Badge variant="secondary" className="hidden sm:inline-flex">Online</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" className="flex items-center gap-3 px-2">
                    <Avatar>
                      <AvatarFallback>AD</AvatarFallback>
                    </Avatar>
                    <span className="hidden text-left sm:block">
                      <span className="block text-sm font-medium">Administrator</span>
                      <span className="block text-xs text-muted-foreground">Hospital Admin</span>
                    </span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Administrator</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut size={16} /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <section className="space-y-6 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                City Hospital / Workspace
              </p>
              <h1 className="text-3xl font-bold tracking-tight">{page}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {page === "Dashboard"
                  ? "Here's an overview of your hospital."
                  : `Manage your hospital ${page.toLowerCase()}.`}
              </p>
            </div>
            <Badge variant="outline">Hospital Admin</Badge>
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
                    <div className="text-3xl font-bold">{patientTotal}</div>
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
                    <div className="text-3xl font-bold">{appointmentTotal}</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Loaded from the API
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
                    <div className="text-3xl font-bold">Online</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Dashboard is running
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
                            <TableCell>{patient.phone || "—"}</TableCell>
                            <TableCell>{patient.email || "—"}</TableCell>
                            <TableCell>{patient.dateOfBirth}</TableCell>
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
                        min={new Date(
                          Date.now() - new Date().getTimezoneOffset() * 60000,
                        ).toISOString().slice(0, 16)}
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
