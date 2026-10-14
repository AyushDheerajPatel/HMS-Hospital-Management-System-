import { useEffect, useState, type FormEvent } from "react";
import { UserPlus, UserRoundMinus } from "lucide-react";
import {
  addHospitalMembership,
  ApiError,
  getHospitalMemberships,
  removeHospitalMembership,
  updateHospitalMembershipRole,
  type HospitalMembership,
} from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Props = { tenantId: string };

const roles = ["admin", "doctor", "receptionist", "staff"] as const;

export function HospitalStaffSettings({ tenantId }: Props) {
  const [memberships, setMemberships] = useState<HospitalMembership[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof roles)[number]>("staff");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      setMemberships(await getHospitalMemberships(tenantId));
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load hospital staff.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void getHospitalMemberships(tenantId)
      .then((items) => {
        if (!cancelled) setMemberships(items);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        if (loadError instanceof ApiError && loadError.status === 401) {
          window.dispatchEvent(new Event("hms:unauthorized"));
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load hospital staff.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const membership = await addHospitalMembership(email, role, tenantId);
      setMemberships((current) =>
        [...current, membership].sort((left, right) =>
          left.email.localeCompare(right.email),
        ),
      );
      setEmail("");
      setNotice(
        "Hospital membership added. The member should sign out and back in to refresh their hospital list.",
      );
    } catch (addError) {
      if (addError instanceof ApiError && addError.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setError(
        addError instanceof Error
          ? addError.message
          : "Unable to add hospital staff.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(
    membership: HospitalMembership,
    nextRole: string,
  ) {
    setError("");
    setNotice("");
    try {
      const updated = await updateHospitalMembershipRole(
        membership.membershipId,
        nextRole,
        tenantId,
      );
      setMemberships((current) =>
        current.map((item) =>
          item.membershipId === updated.membershipId ? updated : item,
        ),
      );
      setNotice(`Updated ${updated.email}'s hospital role.`);
    } catch (updateError) {
      if (updateError instanceof ApiError && updateError.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update hospital role.",
      );
      await reload();
    }
  }

  async function removeStaff(membership: HospitalMembership) {
    if (!window.confirm(`Remove ${membership.email} from this hospital?`)) return;
    setError("");
    setNotice("");
    try {
      await removeHospitalMembership(membership.membershipId, tenantId);
      setMemberships((current) =>
        current.filter((item) => item.membershipId !== membership.membershipId),
      );
      setNotice(`${membership.email} was removed from this hospital.`);
    } catch (removeError) {
      if (removeError instanceof ApiError && removeError.status === 401) {
        window.dispatchEvent(new Event("hms:unauthorized"));
      }
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Unable to remove hospital staff.",
      );
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Hospital staff</CardTitle>
          <CardDescription>
            Add an existing account and assign its hospital role. Staff need to register an HMS account before they can be added.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-[1fr_12rem_auto]" onSubmit={addStaff}>
            <div className="space-y-2">
              <Label htmlFor="staff-email">Account email</Label>
              <Input id="staff-email" type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-role">Hospital role</Label>
              <Select value={role} onValueChange={(value) => setRole((value ?? "staff") as (typeof roles)[number])}>
                <SelectTrigger id="staff-role" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={saving}>
                <UserPlus size={16} /> {saving ? "Adding..." : "Add staff"}
              </Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Admin: manage hospital and staff. Doctor: manage clinical records. Receptionist: manage patients and appointments. Staff: view patients and appointments.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current members</CardTitle>
          <CardDescription>{memberships.length} hospital member(s)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {notice && <p className="text-sm text-green-700" role="status">{notice}</p>}
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>
          ) : memberships.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">No hospital members found.</p>
          ) : (
            memberships.map((membership) => (
              <div key={membership.membershipId} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <div>
                  <p className="font-medium">{membership.email}</p>
                  <p className="text-xs text-muted-foreground">{membership.userId}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={membership.role} onValueChange={(value) => value && void changeRole(membership, value)}>
                    <SelectTrigger className="w-40" aria-label={`Role for ${membership.email}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roles.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" aria-label={`Remove ${membership.email}`} onClick={() => void removeStaff(membership)}>
                    <UserRoundMinus size={16} />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
