namespace Hms.Api.Features.Appointments.UpdateAppointment;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPut(
            "/api/appointments/{appointmentId:guid}",
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
