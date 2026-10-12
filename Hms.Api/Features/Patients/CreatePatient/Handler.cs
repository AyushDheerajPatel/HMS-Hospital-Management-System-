using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Api.Features.Dashboard;
using Hms.Domain.Patients;
using Hms.Infrastructure.Persistence;

namespace Hms.Api.Features.Patients.CreatePatient;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly ITenantContext _tenantContext;
    private readonly DashboardStatsCache _dashboardCache;

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext,
        DashboardStatsCache dashboardCache)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
        _dashboardCache = dashboardCache;
    }

    public async Task<Patient> HandleAsync(
        Command command,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.TenantId;

        if (tenantId is null)
        {
            throw new ValidationException(
                "Tenant context is required.");
        }

        if (string.IsNullOrWhiteSpace(command.FirstName))
        {
            throw new ValidationException(
                "First name is required.");
        }

        if (string.IsNullOrWhiteSpace(command.LastName))
        {
            throw new ValidationException(
                "Last name is required.");
        }

        if (command.DateOfBirth > DateOnly.FromDateTime(DateTime.UtcNow))
        {
            throw new ValidationException(
                "Date of birth cannot be in the future.");
        }

        var patient = new Patient(
            Guid.NewGuid(),
            tenantId.Value,
            command.FirstName.Trim(),
            command.LastName.Trim(),
            command.DateOfBirth,
            command.Phone?.Trim(),
            command.Email?.Trim().ToLowerInvariant());

        _dbContext.Patients.Add(patient);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await _dashboardCache.InvalidateAsync(tenantId.Value, cancellationToken);

        return patient;
    }
}