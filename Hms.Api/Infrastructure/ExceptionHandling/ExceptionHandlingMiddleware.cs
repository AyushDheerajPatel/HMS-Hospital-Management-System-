using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Extensions;

namespace Hms.Api.Infrastructure.ExceptionHandling;

public sealed class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IProblemDetailsService _problemDetailsService;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(
        RequestDelegate next,
        IProblemDetailsService problemDetailsService,
        ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _problemDetailsService = problemDetailsService;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (ValidationException exception)
        {
            await WriteProblemDetailsAsync(
                context,
                StatusCodes.Status400BadRequest,
                "Validation failed",
                exception.Message);
        }
        catch (ConflictException exception)
        {
            await WriteProblemDetailsAsync(
                context,
                StatusCodes.Status409Conflict,
                "Conflict",
                exception.Message);
        }
        catch (ForbiddenException exception)
        {
            await WriteProblemDetailsAsync(
                context,
                StatusCodes.Status403Forbidden,
                "Forbidden",
                exception.Message);
        }
        catch (SessionStoreUnavailableException exception)
        {
            _logger.LogError(
                "Authentication session state is unavailable; exception type {ExceptionType}.",
                exception.InnerException?.GetType().Name ?? exception.GetType().Name);
            context.Response.Headers.RetryAfter = "5";
            await WriteProblemDetailsAsync(
                context,
                StatusCodes.Status503ServiceUnavailable,
                "Authentication service unavailable",
                "Please retry the request shortly.");
        }
        catch (Exception exception)
        {
            _logger.LogError(
                "Unhandled request failure for {Method} {Path}; exception type {ExceptionType}.",
                context.Request.Method,
                context.Request.Path,
                exception.GetType().Name);

            await WriteProblemDetailsAsync(
                context,
                StatusCodes.Status500InternalServerError,
                "Internal server error",
                "An unexpected error occurred.");
        }
    }

    private async Task WriteProblemDetailsAsync(
        HttpContext context,
        int statusCode,
        string title,
        string detail)
    {
        context.Response.StatusCode = statusCode;

        await _problemDetailsService.WriteAsync(
            new ProblemDetailsContext
            {
                HttpContext = context,
                ProblemDetails =
                {
                    Status = statusCode,
                    Title = title,
                    Detail = detail,
                    Instance = context.Request.Path
                }
            });
    }
}