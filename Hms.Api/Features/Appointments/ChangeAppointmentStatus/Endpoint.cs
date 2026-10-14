namespace Hms.Api.Features.Appointments.ChangeAppointmentStatus;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPatch(
            "/api/appointments/{appointmentId:guid}/status",
            async (
                Guid appointmentId,
                Command command,
                Handler handler,
                CancellationToken cancellationToken) =>
            {
                var appointment = await handler.HandleAsync(
                    appointmentId,
                    command,
                    cancellationToken);
                return Results.Ok(appointment);
            });
    }
}
