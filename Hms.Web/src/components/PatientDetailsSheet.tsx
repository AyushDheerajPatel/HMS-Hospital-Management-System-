import { useEffect, useState } from "react";
import { ApiError, getPatient, type Patient } from "../api";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  patient: Patient;
  tenantId: string;
  onOpenChange: (open: boolean) => void;
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function PatientDetailsSheet({ patient, tenantId, onOpenChange }: Props) {
  const [details, setDetails] = useState<Patient | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void getPatient(patient.id, tenantId)
      .then((result) => {
        if (!cancelled) setDetails(result);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        if (loadError instanceof ApiError && loadError.status === 401) {
          window.dispatchEvent(new Event("hms:unauthorized"));
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load patient details.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [patient, tenantId]);

  const visiblePatient = details ?? patient;
  const loading = details === null && error === "";

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>Patient details</SheetTitle>
          <SheetDescription>
            Patient profile and contact information.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 overflow-y-auto px-4 pb-4">
          {loading && (
            <div className="space-y-3" aria-label="Refreshing patient details">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {visiblePatient && (
            <>
              <div>
                <h3 className="text-lg font-semibold">
                  {visiblePatient.firstName} {visiblePatient.lastName}
                </h3>
                <p className="break-all text-sm text-muted-foreground">
                  Patient ID: {visiblePatient.id}
                </p>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Date of birth</dt>
                  <dd className="text-sm font-medium">
                    {visiblePatient.dateOfBirth
                      ? formatDate(visiblePatient.dateOfBirth)
                      : "Not available offline"}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Status</dt>
                  <dd><Badge variant="secondary">{visiblePatient.status}</Badge></dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Phone</dt>
                  <dd className="text-sm font-medium">
                    {visiblePatient.phone || "Not provided"}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Email</dt>
                  <dd className="break-all text-sm font-medium">
                    {visiblePatient.email || "Not provided"}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Registered</dt>
                  <dd className="text-sm font-medium">
                    {visiblePatient.createdAtUtc
                      ? formatDate(visiblePatient.createdAtUtc)
                      : "Not available offline"}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
