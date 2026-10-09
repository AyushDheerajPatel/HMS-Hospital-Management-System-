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
                Handler handler) =>
            {
                var record = await handler.HandleAsync(
                    patientId,
                    command);

                return Results.Created(
                    $"/api/patients/{patientId}/clinical-records/{record.Id}",
                    record);
            });
    }
}