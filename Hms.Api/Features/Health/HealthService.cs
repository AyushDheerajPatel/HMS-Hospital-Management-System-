namespace Hms.Api.Features.Health;

public sealed class HealthService
{
    public string GetStatus()
    {
        return "ok";
    }
}