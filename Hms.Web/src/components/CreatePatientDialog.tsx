import { useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError, createPatient, type Patient } from "../api";

type Props = {
  tenantId: string;
  onCreated: (patient: Patient) => void;
};

export function CreatePatientDialog({ tenantId, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsedDate = new Date(`${dateOfBirth}T00:00:00`);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate > new Date()) {
      setError("Enter a valid date of birth that is not in the future.");
      return;
    }

    setSaving(true);
    try {
      const patient = await createPatient(
        {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth,
          phone: phone.trim() || null,
          email: email.trim() || null,
        },
        tenantId,
      );
      onCreated(patient);
      setOpen(false);
      setFirstName("");
      setLastName("");
      setDateOfBirth("");
      setPhone("");
      setEmail("");
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setError(
        submitError instanceof TypeError
          ? "Could not reach the hospital server. Check your connection and try again."
          : submitError instanceof Error
            ? submitError.message
            : "Unable to create patient.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <UserPlus size={18} /> Add patient
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register patient</DialogTitle>
          <DialogDescription>
            Add a patient to the active hospital directory.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="patient-first-name">First name</Label>
              <Input
                id="patient-first-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="patient-last-name">Last name</Label>
              <Input
                id="patient-last-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                maxLength={100}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="patient-date-of-birth">Date of birth</Label>
            <Input
              id="patient-date-of-birth"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="patient-phone">Phone (optional)</Label>
            <Input
              id="patient-phone"
              type="tel"
              maxLength={30}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="patient-email">Email (optional)</Label>
            <Input
              id="patient-email"
              type="email"
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Create patient"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
