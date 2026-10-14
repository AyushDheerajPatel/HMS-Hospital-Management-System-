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
        if (context.Request.Path == "/api/auth/login" ||
        context.Request.Path == "/api/auth/session" ||
        context.Request.Path == "/api/auth/logout" ||
            context.Request.Path == "/api/auth/logout-all" ||
            context.Request.Path == "/api/auth/register" ||
            context.Request.Path == "/api/health" ||
            context.Request.Path == "/api/tenants/register" ||
            context.Request.Path.StartsWithSegments("/hubs/hospital"))
        {
            await _next(context);
            return;
        }

        if (context.Request.Path == "/api/tenants" &&
            HttpMethods.IsPost(context.Request.Method))
        {
            if (currentUser.UserId is null)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            var hasAdminMembership = await dbContext.TenantMemberships
                .AsNoTracking()
                .AnyAsync(
                    membership =>
                        membership.UserId == currentUser.UserId.Value &&
                        membership.Role.ToLower() == "admin",
                    context.RequestAborted);
            if (!hasAdminMembership)
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new
                {
                    error = "Only a hospital administrator may create a hospital."
                });
                return;
            }

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

        var membership = await dbContext.TenantMemberships
            .AsNoTracking()
            .Where(x =>
                x.UserId == currentUser.UserId.Value &&
                x.TenantId == tenantId)
            .Select(x => x.Role)
            .SingleOrDefaultAsync(context.RequestAborted);

        if (membership is null)
        {
            context.Response.StatusCode =
                StatusCodes.Status403Forbidden;

            await context.Response.WriteAsJsonAsync(new
            {
                error = "You do not have access to this tenant."
            });

            return;
        }

        if (!TenantRolePermissions.HasPermission(
            membership,
            context.Request.Method,
            context.Request.Path))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "Your hospital role does not permit this action."
            });
            return;
        }

        tenantContext.SetTenant(tenantId);

        await _next(context);
    }
}

internal static class TenantRolePermissions
{
    internal static bool HasPermission(
        string role,
        string method,
        PathString path)
    {
        var normalizedRole = role.Trim().ToLowerInvariant();
        var isAdmin = normalizedRole == "admin";
        var isDoctor = normalizedRole == "doctor";
        var isReceptionist = normalizedRole == "receptionist";
        var isStaff = normalizedRole == "staff";
        var segments = (path.Value ?? string.Empty)
            .Split('/', StringSplitOptions.RemoveEmptyEntries);

        if (IsRoute(segments, "api", "tenant-context") ||
            IsRoute(segments, "api", "dashboard", "stats"))
        {
            return HttpMethods.IsGet(method) &&
                (isAdmin || isDoctor || isReceptionist || isStaff);
        }

        if (IsRoute(segments, "api", "patients"))
        {
            return HttpMethods.IsGet(method)
                ? isAdmin || isDoctor || isReceptionist || isStaff
                : HttpMethods.IsPost(method) && (isAdmin || isReceptionist);
        }

        if (segments.Length == 3 &&
            SegmentEquals(segments[0], "api") &&
            SegmentEquals(segments[1], "patients") &&
            Guid.TryParse(segments[2], out _))
        {
            return HttpMethods.IsGet(method) &&
                (isAdmin || isDoctor || isReceptionist || isStaff);
        }

        if (IsClinicalRecordRoute(segments))
        {
            return (isAdmin || isDoctor) &&
                (segments.Length == 4
                    ? HttpMethods.IsGet(method) || HttpMethods.IsPost(method)
                    : HttpMethods.IsPut(method) || HttpMethods.IsDelete(method));
        }

        if (IsRoute(segments, "api", "appointments"))
        {
            return (HttpMethods.IsGet(method) &&
                    (isAdmin || isDoctor || isReceptionist || isStaff)) ||
                (HttpMethods.IsPost(method) &&
                    (isAdmin || isDoctor || isReceptionist));
        }

        if (segments.Length == 3 &&
            SegmentEquals(segments[0], "api") &&
            SegmentEquals(segments[1], "appointments") &&
            (SegmentEquals(segments[2], "doctors") ||
             SegmentEquals(segments[2], "availability")))
        {
            return HttpMethods.IsGet(method)
                ? isAdmin || isDoctor || isReceptionist || isStaff
                : SegmentEquals(segments[2], "availability") &&
                    HttpMethods.IsPut(method) &&
                    (isAdmin || isDoctor);
        }

        if (IsRoute(segments, "api", "appointments", "updates"))
        {
            return HttpMethods.IsGet(method) &&
                (isAdmin || isDoctor || isReceptionist || isStaff);
        }

        if (segments.Length == 3 &&
            SegmentEquals(segments[0], "api") &&
            SegmentEquals(segments[1], "appointments") &&
            Guid.TryParse(segments[2], out _))
        {
            return HttpMethods.IsPut(method) &&
                (isAdmin || isDoctor || isReceptionist);
        }

        if (segments.Length == 4 &&
            SegmentEquals(segments[0], "api") &&
            SegmentEquals(segments[1], "appointments") &&
            Guid.TryParse(segments[2], out _) &&
            (SegmentEquals(segments[3], "schedule") ||
             SegmentEquals(segments[3], "status")))
        {
            return (SegmentEquals(segments[3], "schedule")
                    ? HttpMethods.IsPut(method)
                    : HttpMethods.IsPatch(method)) &&
                (isAdmin || isDoctor || isReceptionist);
        }

        if (IsRoute(segments, "api", "sync", "appointments"))
        {
            return HttpMethods.IsPost(method) &&
                (isAdmin || isDoctor || isReceptionist);
        }

        return isAdmin;
    }

    private static bool IsClinicalRecordRoute(string[] segments) =>
        (segments.Length == 4 || segments.Length == 5) &&
        SegmentEquals(segments[0], "api") &&
        SegmentEquals(segments[1], "patients") &&
        Guid.TryParse(segments[2], out _) &&
        SegmentEquals(segments[3], "clinical-records") &&
        (segments.Length == 4 || !string.IsNullOrWhiteSpace(segments[4]));

    private static bool IsRoute(string[] segments, params string[] expected) =>
        segments.Length == expected.Length &&
        segments.Zip(expected).All(pair => SegmentEquals(pair.First, pair.Second));

    private static bool SegmentEquals(string value, string expected) =>
        string.Equals(value, expected, StringComparison.OrdinalIgnoreCase);
}