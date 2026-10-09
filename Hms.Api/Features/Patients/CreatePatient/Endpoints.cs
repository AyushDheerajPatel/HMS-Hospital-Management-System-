namespace Hms.Api.Features.Patients.CreatePatient;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
            "/api/patients",
            async (
                Command command,
                Handler handler) =>
            {
                var patient = await handler.HandleAsync(command);

                return Results.Created(
                    $"/api/patients/{patient.Id}",
                    patient);
            });
    }
}