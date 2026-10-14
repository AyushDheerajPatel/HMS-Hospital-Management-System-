namespace Hms.Api.Features.Auth.Login;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/auth/login", async (
            Command command,
            Handler handler,
            CancellationToken cancellationToken) =>
        {
            var response = await handler.HandleAsync(
                command,
                cancellationToken);
            return Results.Ok(response);
        });
    }
}