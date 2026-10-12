namespace Hms.Api.Features.ClinicalRecords.CreateClinicalRecord;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
            "/api/patients/{patientId:guid}/clinical-records",
            async (
                Guid patientId,
                Command command,
                Handler handler,
                CancellationToken cancellationToken) =>
            {
                var record = await handler.HandleAsync(
                    patientId,
                    command,
                    cancellationToken);

                return Results.Created(
                    $"/api/patients/{patientId}/clinical-records/{record.Id}",
                    record);
            });
    }
}