using StackExchange.Redis;

namespace Hms.Api.Infrastructure.Auth;

public sealed class RedisActiveSessionStore : IActiveSessionStore
{
    private const string KeyPrefix = "hms:auth:active-session:";
    private const string RevokeScript = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        end
        return 0
        """;

    private readonly IConnectionMultiplexer _connectionMultiplexer;

    public RedisActiveSessionStore(
        IConnectionMultiplexer connectionMultiplexer)
    {
        _connectionMultiplexer = connectionMultiplexer;
    }

    public async Task ActivateAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            await _connectionMultiplexer
                .GetDatabase()
                .StringSetAsync(
                    GetKey(userId),
                    FormatSessionId(sessionId),
                    ActiveSessionConstants.AccessTokenLifetime)
                .WaitAsync(cancellationToken);
        }
        catch (RedisException exception)
        {
            throw new SessionStoreUnavailableException(exception);
        }
    }

    public async Task<bool> IsActiveAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            var activeSessionId = await _connectionMultiplexer
                .GetDatabase()
                .StringGetAsync(GetKey(userId))
                .WaitAsync(cancellationToken);

            return Guid.TryParseExact(
                    activeSessionId,
                    "N",
                    out var parsedSessionId) &&
                parsedSessionId == sessionId;
        }
        catch (RedisException exception)
        {
            throw new SessionStoreUnavailableException(exception);
        }
    }

    public async Task RevokeAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            await _connectionMultiplexer
                .GetDatabase()
                .ScriptEvaluateAsync(
                    RevokeScript,
                    [GetKey(userId)],
                    [FormatSessionId(sessionId)])
                .WaitAsync(cancellationToken);
        }
        catch (RedisException exception)
        {
            throw new SessionStoreUnavailableException(exception);
        }
    }

    private static RedisKey GetKey(Guid userId) =>
        $"{KeyPrefix}{userId:N}";

    private static string FormatSessionId(Guid sessionId) =>
        sessionId.ToString("N");
}
