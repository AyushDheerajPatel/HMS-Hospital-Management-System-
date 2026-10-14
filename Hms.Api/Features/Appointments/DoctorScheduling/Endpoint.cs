namespace Hms.Api.Features.Appointments.DoctorScheduling;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/appointments/doctors",
            async (Handler handler, CancellationToken cancellationToken) =>
                Results.Ok(await handler.ListDoctorsAsync(cancellationToken)));

        endpoints.MapGet(
            "/api/appointments/availability",
            async (
                Guid doctorId,
                DateOnly date,
                Handler handler,
                CancellationToken cancellationToken) =>
                Results.Ok(await handler.GetSlotsAsync(
                    doctorId,
                    date,
                    cancellationToken)));

        endpoints.MapPut(
            "/api/appointments/availability",
            async (
                SetAvailabilityCommand command,
                Handler handler,
                CancellationToken cancellationToken) =>
                Results.Ok(await handler.SetAvailabilityAsync(
                    command,
                    cancellationToken)));
    }
}

public sealed record SetAvailabilityCommand(
    Guid DoctorId,
    DateOnly Date,
    TimeOnly StartTimeUtc,
    TimeOnly EndTimeUtc);
