namespace Hms.Api.Features.Appointments.CreateAppointment;

public sealed record Command(
    Guid PatientId,
    DateTime ScheduledAtUtc,
    string Reason
);