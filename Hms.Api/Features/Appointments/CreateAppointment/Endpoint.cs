namespace Hms.Api.Features.Appointments.CreateAppointment;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
            "/api/appointments",
            async (
                Command command,
                Handler handler) =>
            {
                var appointment =
                    await handler.HandleAsync(command);

                return Results.Created(
                    $"/api/appointments/{appointment.Id}",
                    appointment);
            });
    }
}