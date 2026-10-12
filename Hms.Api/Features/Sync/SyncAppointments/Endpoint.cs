using Hms.Api.Infrastructure.Errors;
using Hms.Api.Features.Appointments.CreateAppointment;

namespace Hms.Api.Features.Sync.SyncAppointments;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
            "/api/sync/appointments",
            async (
                Command command,
                Handler handler,
                CancellationToken cancellationToken) =>
            {
                if (command.ClientOperationId is null)
                {
                    throw new ValidationException(
                        "A client operation ID is required for synchronization.");
                }

                var appointment = await handler.HandleAsync(
                    command,
                    cancellationToken);
                return Results.Ok(appointment);
            });
    }
}
