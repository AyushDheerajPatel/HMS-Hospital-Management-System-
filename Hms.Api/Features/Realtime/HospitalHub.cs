using System.Security.Claims;
using Hms.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Realtime;

[Authorize]
public sealed class HospitalHub : Hub
{
    private readonly HmsDbContext _dbContext;

    public HospitalHub(HmsDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public override async Task OnConnectedAsync()
    {
        var userIdValue = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? Context.User?.FindFirstValue("sub");
        var sessionIdValue = Context.User?.FindFirstValue("sid");

        if (!Guid.TryParse(userIdValue, out var userId) ||
            userId == Guid.Empty ||
            !Guid.TryParse(sessionIdValue, out var sessionId) ||
            sessionId == Guid.Empty)
        {
            Context.Abort();
            return;
        }

        var tenantIds = await _dbContext.TenantMemberships
            .AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => x.TenantId)
            .Distinct()
            .ToListAsync(Context.ConnectionAborted);

        foreach (var tenantId in tenantIds)
        {
            await Groups.AddToGroupAsync(
                Context.ConnectionId,
                HospitalGroupNames.Tenant(tenantId),
                Context.ConnectionAborted);
        }

        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            HospitalGroupNames.User(userId),
            Context.ConnectionAborted);
        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            HospitalGroupNames.Session(sessionId),
            Context.ConnectionAborted);

        await base.OnConnectedAsync();
    }
}

public static class HospitalGroupNames
{
    public static string Tenant(Guid tenantId) => $"tenant:{tenantId:N}";

    public static string User(Guid userId) => $"user:{userId:N}";

    public static string Session(Guid sessionId) => $"session:{sessionId:N}";
}

public sealed record AppointmentUpdatedEvent(
    Guid AppointmentId,
    Guid TenantId,
    string Status,
    DateTime UpdatedAtUtc,
    string EventType = "AppointmentUpdated");

public sealed record SessionRevokedEvent(
    Guid UserId,
    Guid SessionId,
    string Reason,
    DateTime RevokedAtUtc);
