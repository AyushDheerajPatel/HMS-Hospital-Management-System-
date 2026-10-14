using System.Security.Claims;

namespace Hms.Api.Features.Auth.Session;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
                "/api/auth/session",
                (ClaimsPrincipal user) =>
                {
                    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)
                        ?? user.FindFirstValue("sub");
                    return Guid.TryParse(userId, out var parsedUserId) &&
                        parsedUserId != Guid.Empty
                        ? Results.Ok(new Response(parsedUserId))
                        : Results.Unauthorized();
                })
            .RequireAuthorization();
    }

    private sealed record Response(Guid UserId);
}
