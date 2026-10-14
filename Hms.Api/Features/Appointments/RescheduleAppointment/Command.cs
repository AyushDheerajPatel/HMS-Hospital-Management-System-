namespace Hms.Api.Features.Appointments.RescheduleAppointment;

public sealed record Command(
    DateTime ScheduledAtUtc,
    int ExpectedVersion
);
