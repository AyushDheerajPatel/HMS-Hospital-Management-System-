using System.Text.Json;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Distributed;
using StackExchange.Redis;

namespace Hms.Api.Features.Dashboard;

public sealed record DashboardStats(
    int PatientCount,
    int ActivePatientCount,
    int UpcomingAppointmentCount
);

public sealed class DashboardStatsCache
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(1);
    private readonly IDistributedCache? _cache;
    private readonly ILogger<DashboardStatsCache> _logger;

    public DashboardStatsCache(
        IEnumerable<IDistributedCache> caches,
        ILogger<DashboardStatsCache> logger)
    {
        _cache = caches.FirstOrDefault();
        _logger = logger;
    }

    public async Task<DashboardStats?> GetAsync(
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        if (_cache is null)
        {
            return null;
        }

        try
        {
            var value = await _cache.GetStringAsync(
                GetKey(tenantId),
                cancellationToken);
            return value is null ? null : JsonSerializer.Deserialize<DashboardStats>(value);
        }
        catch (RedisException exception)
        {
            _logger.LogWarning(
                "Redis read failed for tenant dashboard cache ({ExceptionType}).",
                exception.GetType().Name);
            return null;
        }
        catch (JsonException)
        {
            _logger.LogWarning("Redis dashboard cache contained invalid JSON.");
            return null;
        }
    }

    public async Task SetAsync(
        Guid tenantId,
        DashboardStats stats,
        CancellationToken cancellationToken)
    {
        if (_cache is null)
        {
            return;
        }

        try
        {
            await _cache.SetStringAsync(
                GetKey(tenantId),
                JsonSerializer.Serialize(stats),
                new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = Lifetime },
                cancellationToken);
        }
        catch (RedisException exception)
        {
            _logger.LogWarning(
                "Redis write failed for tenant dashboard cache ({ExceptionType}).",
                exception.GetType().Name);
        }
    }

    public async Task InvalidateAsync(
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        if (_cache is null)
        {
            return;
        }

        try
        {
            await _cache.RemoveAsync(GetKey(tenantId), cancellationToken);
        }
        catch (RedisException exception)
        {
            _logger.LogWarning(
                "Redis invalidation failed for tenant dashboard cache ({ExceptionType}).",
                exception.GetType().Name);
        }
    }

    private static string GetKey(Guid tenantId) =>
        $"dashboard:{tenantId:N}";
}

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly ITenantContext _tenantContext;
    private readonly DashboardStatsCache _cache;

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext,
        DashboardStatsCache cache)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
        _cache = cache;
    }

    public async Task<DashboardStats> HandleAsync(
        CancellationToken cancellationToken)
    {
        var tenantId = _tenantContext.TenantId
            ?? throw new Hms.Api.Infrastructure.Errors.ValidationException(
                "Tenant context is required.");

        var cached = await _cache.GetAsync(tenantId, cancellationToken);
        if (cached is not null)
        {
            return cached;
        }

        var now = DateTime.UtcNow;
        var stats = new DashboardStats(
            await _dbContext.Patients.CountAsync(
                x => x.TenantId == tenantId,
                cancellationToken),
            await _dbContext.Patients.CountAsync(
                x => x.TenantId == tenantId && x.Status == "active",
                cancellationToken),
            await _dbContext.Appointments.CountAsync(
                x => x.TenantId == tenantId &&
                     x.Status == "scheduled" &&
                     x.ScheduledAtUtc >= now,
                cancellationToken));

        await _cache.SetAsync(tenantId, stats, cancellationToken);
        return stats;
    }
}

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/dashboard/stats",
            async (Handler handler, CancellationToken cancellationToken) =>
                Results.Ok(await handler.HandleAsync(cancellationToken)));
    }
}
