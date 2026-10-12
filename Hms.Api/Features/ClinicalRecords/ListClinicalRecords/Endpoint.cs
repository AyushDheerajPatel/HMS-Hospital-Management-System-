namespace Hms.Api.Features.ClinicalRecords.ListClinicalRecords;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/patients/{patientId:guid}/clinical-records",
            async (
                Guid patientId,
                [AsParameters] Query query,
                Handler handler,
                CancellationToken cancellationToken) =>
            {
                var records = await handler.HandleAsync(
                    patientId,
                    query,
                    cancellationToken);
                return Results.Ok(records);
            });
    }
}
