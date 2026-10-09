namespace Hms.Api.Features.Patients.GetPatient;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/patients/{id:guid}",
            async (
                Guid id,
                Handler handler) =>
            {
                var patient = await handler.HandleAsync(
                    new Query(id));

                return Results.Ok(patient);
            });
    }
}