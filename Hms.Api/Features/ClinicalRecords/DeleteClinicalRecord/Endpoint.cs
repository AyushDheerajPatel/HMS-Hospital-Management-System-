namespace Hms.Api.Features.ClinicalRecords.DeleteClinicalRecord;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapDelete(
            "/api/patients/{patientId:guid}/clinical-records/{recordId}",
            async (
                Guid patientId,
                string recordId,
                Handler handler,
                CancellationToken cancellationToken) =>
            {
                await handler.HandleAsync(
                    patientId,
                    recordId,
                    cancellationToken);
                return Results.NoContent();
            });
    }
}
