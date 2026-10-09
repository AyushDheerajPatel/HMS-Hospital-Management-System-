namespace Hms.Api.Features.Appointments.ListAppointments;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/appointments",
            async (
                [AsParameters] Query query,
                Handler handler) =>
            {
                var response =
                    await handler.HandleAsync(query);

                return Results.Ok(response);
            });
    }
}