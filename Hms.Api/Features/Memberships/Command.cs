namespace Hms.Api.Features.Memberships;

public sealed record Command(string Email, string Role);

public sealed record ChangeRoleCommand(string Role);
