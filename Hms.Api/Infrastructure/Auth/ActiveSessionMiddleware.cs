using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;

namespace Hms.Api.Infrastructure.Auth;

public sealed class ActiveSessionMiddleware
{
    private static readonly HashSet<string> PublicPaths =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "/api/auth/login",
            "/api/auth/register",
            "/api/health",
            "/api/tenants/register"
        };

    private static readonly HashSet<string> LogoutPaths =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "/api/auth/logout",
            "/api/auth/logout-all"
        };

    private readonly RequestDelegate _next;
    private readonly ILogger<ActiveSessionMiddleware> _logger;

    public ActiveSessionMiddleware(
        RequestDelegate next,
        ILogger<ActiveSessionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(
        HttpContext context,
        IActiveSessionStore activeSessionStore)
    {
        var path = context.Request.Path.Value ?? string.Empty;
        if (PublicPaths.Contains(path) ||
            LogoutPaths.Contains(path) ||
            context.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() is not null ||
            context.User.Identity?.IsAuthenticated != true)
        {
            await _next(context);
            return;
        }

        var userIdValue = context.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? context.User.FindFirstValue("sub");
        var sessionIdValue = context.User.FindFirstValue("sid");
        if (!Guid.TryParse(userIdValue, out var userId) ||
            userId == Guid.Empty ||
            !Guid.TryParse(sessionIdValue, out var sessionId) ||
            sessionId == Guid.Empty)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        try
        {
            var isActive = await activeSessionStore.IsActiveAsync(
                userId,
                sessionId,
                context.RequestAborted);
            if (!isActive)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
        }
        catch (SessionStoreUnavailableException exception)
        {
            _logger.LogError(
                "Active session validation is unavailable; exception type {ExceptionType}.",
                exception.InnerException?.GetType().Name ?? exception.GetType().Name);
            context.Response.StatusCode =
                StatusCodes.Status503ServiceUnavailable;
            context.Response.Headers.RetryAfter = "5";
            await context.Response.WriteAsJsonAsync(
                new { error = "Authentication service is temporarily unavailable." },
                context.RequestAborted);
            return;
        }

        await _next(context);
    }
}
