namespace Hms.Api.Features.Auth.Login;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/auth/login", async (
            Command command,
            Handler handler) =>
        {
            var response = await handler.HandleAsync(command);
            return Results.Ok(response);
        });
    }
}