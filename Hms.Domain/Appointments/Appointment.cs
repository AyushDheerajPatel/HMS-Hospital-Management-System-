namespace Hms.Domain.Appointments;

public sealed class Appointment
{
    public Guid Id { get; private set; }

    public Guid TenantId { get; private set; }

    public Guid PatientId { get; private set; }

    public Guid? DoctorId { get; private set; }

    public DateTime ScheduledAtUtc { get; private set; }

    public string Reason { get; private set; }

    public string Status { get; private set; }

    public int Version { get; private set; } = 1;

    public DateTime CreatedAtUtc { get; private set; }

    public Appointment(
        Guid id,
        Guid tenantId,
        Guid patientId,
        DateTime scheduledAtUtc,
        string reason)
        : this(
            id,
            tenantId,
            patientId,
            null,
            scheduledAtUtc,
            reason,
            DateTime.UtcNow)
    {
    }

    public Appointment(
        Guid id,
        Guid tenantId,
        Guid patientId,
        DateTime scheduledAtUtc,
        string reason,
        DateTime createdAtUtc)
        : this(
            id,
            tenantId,
            patientId,
            null,
            scheduledAtUtc,
            reason,
            createdAtUtc)
    {
    }

    public Appointment(
        Guid id,
        Guid tenantId,
        Guid patientId,
        Guid doctorId,
        DateTime scheduledAtUtc,
        string reason,
        DateTime createdAtUtc)
        : this(
            id,
            tenantId,
            patientId,
            (Guid?)doctorId,
            scheduledAtUtc,
            reason,
            createdAtUtc)
    {
    }

    private Appointment(
        Guid id,
        Guid tenantId,
        Guid patientId,
        Guid? doctorId,
        DateTime scheduledAtUtc,
        string reason,
        DateTime createdAtUtc)
    {
        Id = id;
        TenantId = tenantId;
        PatientId = patientId;
        DoctorId = doctorId;
        ScheduledAtUtc = scheduledAtUtc;
        Reason = reason;
        Status = "scheduled";
        CreatedAtUtc = createdAtUtc;
    }

    public void Reschedule(DateTime scheduledAtUtc)
    {
        ScheduledAtUtc = scheduledAtUtc;
        Version++;
    }

    public void UpdateDetails(
        Guid patientId,
        DateTime scheduledAtUtc,
        string reason)
    {
        PatientId = patientId;
        ScheduledAtUtc = scheduledAtUtc;
        Reason = reason;
        Version++;
    }

    public void ChangeStatus(string status)
    {
        if (status is not ("cancelled" or "completed"))
        {
            throw new ArgumentException(
                "Appointment status must be cancelled or completed.",
                nameof(status));
        }

        if (Status != "scheduled")
        {
            throw new InvalidOperationException(
                "Only scheduled appointments can change status.");
        }

        Status = status;
        Version++;
    }
}