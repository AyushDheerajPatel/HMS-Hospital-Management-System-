namespace Hms.Domain.Appointments;

public sealed class AppointmentOperation
{
    public Guid TenantId { get; private set; }

    public Guid ClientOperationId { get; private set; }

    public Guid AppointmentId { get; private set; }

    public Guid PatientId { get; private set; }

    public Guid? DoctorId { get; private set; }

    public DateTime ScheduledAtUtc { get; private set; }

    public string Reason { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    public AppointmentOperation(
        Guid tenantId,
        Guid clientOperationId,
        Guid appointmentId,
        Guid patientId,
        Guid? doctorId,
        DateTime scheduledAtUtc,
        string reason,
        DateTime createdAtUtc)
    {
        TenantId = tenantId;
        ClientOperationId = clientOperationId;
        AppointmentId = appointmentId;
        PatientId = patientId;
        DoctorId = doctorId;
        ScheduledAtUtc = scheduledAtUtc;
        Reason = reason;
        CreatedAtUtc = createdAtUtc;
    }
}
