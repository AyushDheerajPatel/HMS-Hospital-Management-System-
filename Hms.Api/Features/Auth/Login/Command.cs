namespace Hms.Api.Features.Auth.Login;

public sealed record Command(
    string Email,
    string Password
);