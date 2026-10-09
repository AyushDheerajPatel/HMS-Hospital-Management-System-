namespace Hms.Api.Features.Tenants.CreateTenant;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/tenants", async (
            Command command,
            Handler handler) =>
        {
            var tenant = await handler.HandleAsync(command);

            return Results.Created(
                $"/api/tenants/{tenant.Id}",
                tenant);
        });
    }
}