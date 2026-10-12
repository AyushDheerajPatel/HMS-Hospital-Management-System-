namespace Hms.Api.Features.Tenants.RegisterTenant;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/tenants/register", async (
            Command command,
            Handler handler,
            CancellationToken cancellationToken) =>
        {
            var result = await handler.HandleAsync(command, cancellationToken);
            return Results.Ok(result);
        });
    }
}
