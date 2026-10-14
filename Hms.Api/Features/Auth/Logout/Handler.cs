using Hms.Api.Features.Realtime;
using Hms.Api.Infrastructure.Auth;

namespace Hms.Api.Features.Auth.Logout;

public sealed class Handler
{
    private readonly IActiveSessionStore _activeSessionStore;
    private readonly HospitalRealtimePublisher? _realtimePublisher;

    public Handler(IActiveSessionStore activeSessionStore)
        : this(activeSessionStore, null)
    {
    }

    public Handler(
        IActiveSessionStore activeSessionStore,
        HospitalRealtimePublisher? realtimePublisher)
    {
        _activeSessionStore = activeSessionStore;
        _realtimePublisher = realtimePublisher;
    }

    public async Task HandleAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        await _activeSessionStore.RevokeAsync(
            userId,
            sessionId,
            cancellationToken);
        if (_realtimePublisher is not null)
        {
            await _realtimePublisher.PublishSessionRevokedAsync(
                userId,
                sessionId,
                "Your session was revoked. Please sign in again.");
        }
    }

    public async Task HandleAllDevicesAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        await _activeSessionStore.RevokeAsync(
            userId,
            sessionId,
            cancellationToken);
        if (_realtimePublisher is not null)
        {
            await _realtimePublisher.PublishSessionRevokedAsync(
                userId,
                sessionId,
                "Your session was removed from all active devices. Please sign in again.");
        }
    }
}
