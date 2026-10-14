using Hms.Api.Features.ClinicalRecords.CreateClinicalRecord;

namespace Hms.Api.Features.ClinicalRecords.UpdateClinicalRecord;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPut(
            "/api/patients/{patientId:guid}/clinical-records/{recordId}",
            async (
                Guid patientId,
                string recordId,
                Command command,
                Handler handler,
                CancellationToken cancellationToken) =>
            {
                var record = await handler.HandleAsync(
                    patientId,
                    recordId,
                    command,
                    cancellationToken);
                return Results.Ok(record);
            });
    }
}
