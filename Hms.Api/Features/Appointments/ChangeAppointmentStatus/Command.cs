namespace Hms.Api.Features.Appointments.ChangeAppointmentStatus;

public sealed record Command(string Status, int ExpectedVersion);
