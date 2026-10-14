namespace Hms.Api.Features.Appointments.UpdateAppointment;

public sealed record Command(
    Guid PatientId,
    DateTime ScheduledAtUtc,
    string Reason,
    int ExpectedVersion
);
