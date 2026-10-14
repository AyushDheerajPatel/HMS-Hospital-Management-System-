namespace Hms.Api.Infrastructure.Auth;

public interface IActiveSessionStore
{
    Task ActivateAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken);

    Task<bool> IsActiveAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken);

    Task RevokeAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken);
}
