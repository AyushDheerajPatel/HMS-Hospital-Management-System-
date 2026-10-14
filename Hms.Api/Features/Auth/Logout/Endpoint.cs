using System.Security.Claims;

namespace Hms.Api.Features.Auth.Logout;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        MapLogoutRoute(
            endpoints,
            "/api/auth/logout",
            allDevices: false);
        MapLogoutRoute(
            endpoints,
            "/api/auth/logout-all",
            allDevices: true);
    }

    private static void MapLogoutRoute(
        IEndpointRouteBuilder endpoints,
        string route,
        bool allDevices)
    {
        endpoints.MapPost(
                route,
                async (
                    ClaimsPrincipal user,
                    Handler handler,
                    CancellationToken cancellationToken) =>
                {
                    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)
                        ?? user.FindFirstValue("sub");
                    var sessionId = user.FindFirst("sid")?.Value;
                    if (!Guid.TryParse(userId, out var parsedUserId) ||
                        parsedUserId == Guid.Empty ||
                        !Guid.TryParse(sessionId, out var parsedSessionId) ||
                        parsedSessionId == Guid.Empty)
                    {
                        return Results.Unauthorized();
                    }

                    if (allDevices)
                    {
                        await handler.HandleAllDevicesAsync(
                            parsedUserId,
                            parsedSessionId,
                            cancellationToken);
                    }
                    else
                    {
                        await handler.HandleAsync(
                            parsedUserId,
                            parsedSessionId,
                            cancellationToken);
                    }

                    return Results.NoContent();
                })
            .RequireAuthorization();
    }
}
