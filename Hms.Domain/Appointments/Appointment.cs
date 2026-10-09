namespace Hms.Domain.Appointments;

public sealed class Appointment
{
    public Guid Id { get; private set; }

    public Guid TenantId { get; private set; }

    public Guid PatientId { get; private set; }

    public DateTime ScheduledAtUtc { get; private set; }

    public string Reason { get; private set; }

    public string Status { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    public Appointment(
        Guid id,
        Guid tenantId,
        Guid patientId,
        DateTime scheduledAtUtc,
        string reason)
    {
        Id = id;
        TenantId = tenantId;
        PatientId = patientId;
        ScheduledAtUtc = scheduledAtUtc;
        Reason = reason;
        Status = "scheduled";
        CreatedAtUtc = DateTime.UtcNow;
    }
}