using Hms.Api.Infrastructure.Auth;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Infrastructure.Tenancy;

public sealed class TenantMiddleware
{
    private readonly RequestDelegate _next;

    public TenantMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(
        HttpContext context,
        ITenantContext tenantContext,
        ICurrentUser currentUser,
        HmsDbContext dbContext)
    {
        // System-level endpoints don't need a tenant.
        if (context.Request.Path.StartsWithSegments("/api/auth") ||
            context.Request.Path.StartsWithSegments("/api/tenants"))
        {
            await _next(context);
            return;
        }

        // The endpoint must be authenticated.
        if (currentUser.UserId is null)
        {
            context.Response.StatusCode =
                StatusCodes.Status401Unauthorized;

            await context.Response.WriteAsJsonAsync(new
            {
                error = "Authentication is required."
            });

            return;
        }

        var tenantHeader = context.Request.Headers["X-Tenant-Id"]
            .FirstOrDefault();

        if (!Guid.TryParse(tenantHeader, out var tenantId))
        {
            context.Response.StatusCode =
                StatusCodes.Status400BadRequest;

            await context.Response.WriteAsJsonAsync(new
            {
                error = "X-Tenant-Id header is required."
            });

            return;
        }

        var membershipExists = await dbContext.TenantMemberships
            .AnyAsync(x =>
                x.UserId == currentUser.UserId.Value &&
                x.TenantId == tenantId);

        if (!membershipExists)
        {
            context.Response.StatusCode =
                StatusCodes.Status403Forbidden;

            await context.Response.WriteAsJsonAsync(new
            {
                error = "You do not have access to this tenant."
            });

            return;
        }

        tenantContext.SetTenant(tenantId);

        await _next(context);
    }
}