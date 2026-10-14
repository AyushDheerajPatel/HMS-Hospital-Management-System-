using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;

namespace Hms.Api.Features.Appointments;

public static class AppointmentUpdatesEndpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/appointments/updates",
            async (
                HttpContext context,
                ITenantContext tenantContext,
                AppointmentUpdates updates) =>
            {
                if (tenantContext.TenantId is not Guid tenantId)
                {
                    throw new ValidationException("Tenant context is required.");
                }

                context.Response.ContentType = "text/event-stream";
                context.Response.Headers.CacheControl = "no-cache";
                context.Response.Headers.Connection = "keep-alive";
                await context.Response.WriteAsync("retry: 3000\n\n");
                await context.Response.Body.FlushAsync(
                    context.RequestAborted);

                try
                {
                    await foreach (var eventName in updates.Subscribe(
                        tenantId,
                        context.RequestAborted))
                    {
                        await context.Response.WriteAsync(
                            $"event: {eventName}\ndata: {{}}\n\n",
                            context.RequestAborted);
                        await context.Response.Body.FlushAsync(
                            context.RequestAborted);
                    }
                }
                catch (OperationCanceledException)
                    when (context.RequestAborted.IsCancellationRequested)
                {
                }
            });
    }
}
