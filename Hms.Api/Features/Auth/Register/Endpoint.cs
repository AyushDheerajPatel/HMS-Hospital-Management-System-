namespace Hms.Api.Features.Auth.Register;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/auth/register", async (
            Command command,
            Handler handler) =>
        {
            var user = await handler.HandleAsync(command);

            return Results.Created(
                $"/api/users/{user.Id}",
                new
                {
                    user.Id,
                    user.Email
                });
        });
    }
}