namespace Hms.Api.Features.Patients.CreatePatient;

public sealed record Command(
    string FirstName,
    string LastName,
    DateOnly DateOfBirth,
    string? Phone,
    string? Email
);