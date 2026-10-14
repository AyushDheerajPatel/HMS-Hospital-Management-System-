import { useRef, useState, type FormEvent } from "react";
import {
  ClipboardList,
  FilePlus2,
  History,
  Pencil,
  Pill,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { ApiError, createClinicalRecord, deleteClinicalRecord, getClinicalRecords, updateClinicalRecord, type ClinicalRecord, type ClinicalRecordDraft, type Patient } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  tenantId: string;
  patients: Patient[];
  patientsLoading: boolean;
  patientsError: string;
  onRetryPatients: () => void;
};

const emptyDraft: ClinicalRecordDraft = {
  diagnosis: "",
  notes: "",
  medications: [],
  allergies: [],
  medicalHistory: "",
};

function toLines(values: string[]): string {
  return values.join("\n");
}

function toDraft(record: ClinicalRecord): ClinicalRecordDraft {
  return {
    diagnosis: record.diagnosis,
    notes: record.notes,
    medications: record.medications ?? [],
    allergies: record.allergies ?? [],
    medicalHistory: record.medicalHistory ?? "",
  };
}

export function ClinicalRecordsPage({
  tenantId,
  patients,
  patientsLoading,
  patientsError,
  onRetryPatients,
}: Props) {
  const [patientId, setPatientId] = useState("");
  const [records, setRecords] = useState<ClinicalRecord[]>([]);
  const [recordsPatientId, setRecordsPatientId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ClinicalRecord | null>(null);
  const [draft, setDraft] = useState<ClinicalRecordDraft>(emptyDraft);
  const [medicationText, setMedicationText] = useState("");
  const [allergyText, setAllergyText] = useState("");
  const [notice, setNotice] = useState("");
  const recordRequestId = useRef(0);
  const selectedPatient = patients.find((patient) => patient.id === patientId);

  async function selectPatient(nextPatientId: string) {
    const requestId = ++recordRequestId.current;
    setPatientId(nextPatientId);
    setRecordsPatientId("");
    setNotice("");
    if (!nextPatientId) {
      setRecords([]);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const items = await getClinicalRecords(nextPatientId, tenantId);
      if (requestId === recordRequestId.current) {
        setRecords(items);
        setRecordsPatientId(nextPatientId);
      }
    } catch (loadError) {
      if (requestId !== recordRequestId.current) return;
      if (loadError instanceof ApiError && loadError.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load clinical records.",
      );
    } finally {
      if (requestId === recordRequestId.current) setLoading(false);
    }
  }
  const visibleRecords =
    recordsPatientId === patientId ? records : [];

  function openNewRecord() {
    setEditing(null);
    setDraft(emptyDraft);
    setMedicationText("");
    setAllergyText("");
    setError("");
    setEditorOpen(true);
  }

  function openEditRecord(record: ClinicalRecord) {
    const nextDraft = toDraft(record);
    setEditing(record);
    setDraft(nextDraft);
    setMedicationText(toLines(nextDraft.medications));
    setAllergyText(toLines(nextDraft.allergies));
    setError("");
    setEditorOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId) return;
    const nextDraft: ClinicalRecordDraft = {
      ...draft,
      diagnosis: draft.diagnosis.trim(),
      notes: draft.notes.trim(),
      medications: medicationText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      allergies: allergyText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      medicalHistory: draft.medicalHistory.trim(),
    };
    if (!nextDraft.diagnosis || !nextDraft.notes) {
      setError("Diagnosis and clinical notes are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = editing
        ? await updateClinicalRecord(patientId, editing.id, nextDraft, tenantId)
        : await createClinicalRecord(patientId, nextDraft, tenantId);
      setRecords((existing) =>
        editing
          ? existing.map((record) => record.id === saved.id ? saved : record)
          : [saved, ...existing],
      );
      setNotice(editing ? "Clinical record updated." : "Clinical record created.");
      setEditorOpen(false);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save clinical record.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeRecord(record: ClinicalRecord) {
    if (!patientId || !window.confirm("Delete this clinical record? This cannot be undone.")) {
      return;
    }
    setError("");
    try {
      await deleteClinicalRecord(patientId, record.id, tenantId);
      setRecords((existing) => existing.filter((item) => item.id !== record.id));
      setNotice("Clinical record deleted.");
    } catch (deleteError) {
      if (deleteError instanceof ApiError && deleteError.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete clinical record.",
      );
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/15 bg-gradient-to-br from-card via-card to-primary/[0.04]">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ClipboardList size={20} />
            </div>
            <CardTitle className="text-xl">Clinical records</CardTitle>
            <CardDescription className="mt-1">
              Securely review diagnoses, prescriptions, allergies, and medical history.
            </CardDescription>
          </div>
          <Select value={patientId} onValueChange={(value) => void selectPatient(value ?? "")}>
            <SelectTrigger
              className="w-full sm:w-80"
              aria-label="Select patient for clinical records"
              disabled={patientsLoading || patients.length === 0}
            >
              <SelectValue
                placeholder={
                  patientsLoading
                    ? "Loading patients..."
                    : patients.length === 0
                      ? "No patients available"
                      : "Select a patient"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {patients.map((patient) => (
                <SelectItem key={patient.id} value={patient.id}>
                  {patient.firstName} {patient.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/80 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {selectedPatient
                  ? `${selectedPatient.firstName[0] ?? ""}${selectedPatient.lastName[0] ?? ""}`.toUpperCase()
                  : <ShieldCheck size={18} />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {selectedPatient
                    ? `${selectedPatient.firstName} ${selectedPatient.lastName}`
                    : "Patient record access"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedPatient
                    ? `Patient ID ${selectedPatient.id.slice(0, 8)} · ${recordsPatientId === patientId ? `${records.length} record${records.length === 1 ? "" : "s"}` : "Choose to load records"}`
                    : "Only authorized hospital clinicians can access this information"}
                </p>
              </div>
            </div>
            {patientId && (
              <Button
                onClick={openNewRecord}
                disabled={patientsLoading || !selectedPatient}
                className="w-full sm:w-auto"
              >
                <FilePlus2 size={17} /> Add clinical record
              </Button>
            )}
          </div>
          {notice && (
            <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary" role="status">
              {notice}
            </p>
          )}
          {patientsError && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-destructive" role="alert">
                {patientsError}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={patientsLoading}
                onClick={onRetryPatients}
              >
                {patientsLoading ? "Loading..." : "Retry patient list"}
              </Button>
            </div>
          )}
          {!patientsLoading && patients.length === 0 && !patientsError && (
            <p className="text-sm text-muted-foreground" role="status">
              No patients are registered at this hospital yet. Add a patient from the Patients page first.
            </p>
          )}
          {error && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-destructive" role="alert">{error}</p>
              {patientId && !editorOpen && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => void selectPatient(patientId)}
                >
                  {loading ? "Loading..." : "Retry records"}
                </Button>
              )}
            </div>
          )}
          {!patientId ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
              <ClipboardList className="size-8 text-muted-foreground/60" />
              <p className="font-medium">Select a patient to get started</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Choose a patient above to securely load their clinical history.
              </p>
            </div>
          ) : loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-24 w-full" />)}</div>
          ) : visibleRecords.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
              <FilePlus2 className="size-8 text-muted-foreground/60" />
              <p className="font-medium">No clinical records yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Add the first clinical note for {selectedPatient?.firstName ?? "this patient"}.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {visibleRecords.map((record) => (
                <Card key={record.id} className="border-border/80 shadow-sm">
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{record.diagnosis}</CardTitle>
                        <Badge variant="secondary">Clinical note</Badge>
                      </div>
                      <CardDescription>
                        Updated {new Date(record.updatedAtUtc ?? record.createdAtUtc).toLocaleString()}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEditRecord(record)} aria-label="Edit clinical record"><Pencil size={16} /></Button>
                      <Button size="sm" variant="destructive" onClick={() => void removeRecord(record)} aria-label="Delete clinical record"><Trash2 size={16} /></Button>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <ClipboardList size={16} className="text-primary" /> Clinical notes
                      </div>
                      <p className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{record.notes}</p>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <Pill size={16} className="text-primary" /> Prescriptions
                      </div>
                      <div className="flex min-h-10 flex-wrap gap-2">{(record.medications ?? []).length ? (record.medications ?? []).map((item) => <Badge key={item} variant="secondary">{item}</Badge>) : <span className="text-sm text-muted-foreground">None recorded</span>}</div>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <TriangleAlert size={16} className="text-amber-600" /> Allergies
                      </div>
                      <div className="flex min-h-10 flex-wrap gap-2">{(record.allergies ?? []).length ? (record.allergies ?? []).map((item) => <Badge key={item} variant="outline" className="border-amber-500/30 text-amber-700">{item}</Badge>) : <span className="text-sm text-muted-foreground">None recorded</span>}</div>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <History size={16} className="text-primary" /> Medical history
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{record.medicalHistory || "None recorded"}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit clinical record" : "Add clinical record"}</DialogTitle>
            <DialogDescription>Clinical information is visible only to hospital administrators and doctors.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="clinical-diagnosis">Diagnosis</Label>
              <Textarea id="clinical-diagnosis" maxLength={200} value={draft.diagnosis} onChange={(event) => setDraft({ ...draft, diagnosis: event.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinical-notes">Clinical notes</Label>
              <Textarea id="clinical-notes" maxLength={5000} rows={4} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinical-medications">Prescriptions (one per line)</Label>
              <Textarea id="clinical-medications" rows={3} value={medicationText} onChange={(event) => setMedicationText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinical-allergies">Allergies (one per line)</Label>
              <Textarea id="clinical-allergies" rows={3} value={allergyText} onChange={(event) => setAllergyText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinical-history">Medical history</Label>
              <Textarea id="clinical-history" maxLength={5000} rows={3} value={draft.medicalHistory} onChange={(event) => setDraft({ ...draft, medicalHistory: event.target.value })} />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : editing ? "Save changes" : "Create record"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
