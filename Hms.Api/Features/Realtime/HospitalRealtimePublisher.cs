using Microsoft.AspNetCore.SignalR;

namespace Hms.Api.Features.Realtime;

public sealed class HospitalRealtimePublisher
{
    private readonly IHubContext<HospitalHub> _hubContext;

    public HospitalRealtimePublisher(IHubContext<HospitalHub> hubContext)
    {
        _hubContext = hubContext;
    }

    // Delivery is best-effort after the database transaction commits.
    // A durable outbox is required for guaranteed delivery semantics.
    public Task PublishAppointmentChangedAsync(
        Guid tenantId,
        Guid appointmentId,
        string status)
    {
        var payload = new AppointmentUpdatedEvent(
            appointmentId,
            tenantId,
            status,
            DateTime.UtcNow,
            "AppointmentUpdated");

        return _hubContext.Clients
            .Group(HospitalGroupNames.Tenant(tenantId))
            .SendAsync("AppointmentUpdated", payload);
    }

    public Task PublishSessionRevokedAsync(
        Guid userId,
        Guid sessionId,
        string reason)
    {
        var payload = new SessionRevokedEvent(
            userId,
            sessionId,
            reason,
            DateTime.UtcNow);

        return Task.WhenAll(
            _hubContext.Clients
                .Group(HospitalGroupNames.User(userId))
                .SendAsync("SessionRevoked", payload),
            _hubContext.Clients
                .Group(HospitalGroupNames.Session(sessionId))
                .SendAsync("SessionRevoked", payload));
    }
}
