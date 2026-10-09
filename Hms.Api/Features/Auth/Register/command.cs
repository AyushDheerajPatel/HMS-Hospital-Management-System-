namespace Hms.Api.Features.Auth.Register;

public sealed record Command(
    string Email,
    string Password
);