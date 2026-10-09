namespace Hms.Api.Features.Patients.ListPatients;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/patients",
            async (
                [AsParameters] Query query,
                Handler handler) =>
            {
                var response =
                    await handler.HandleAsync(query);

                return Results.Ok(response);
            });
    }
}