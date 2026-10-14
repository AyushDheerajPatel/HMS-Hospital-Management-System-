namespace Hms.Api.Features.Appointments.CreateAppointment;

public sealed record Command(
    Guid PatientId,
    Guid DoctorId,
    DateTime ScheduledAtUtc,
    string Reason,
    Guid? ClientOperationId = null
);