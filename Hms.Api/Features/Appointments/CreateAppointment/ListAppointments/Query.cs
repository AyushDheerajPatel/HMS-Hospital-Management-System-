namespace Hms.Api.Features.Appointments.ListAppointments;

public sealed record Query(
    Guid? PatientId,
    string? Status,
    DateTime? FromUtc,
    DateTime? ToUtc,
    int Page = 1,
    int PageSize = 20
);