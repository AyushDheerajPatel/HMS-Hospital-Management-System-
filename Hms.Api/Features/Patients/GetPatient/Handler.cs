using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Patients.GetPatient;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly ITenantContext _tenantContext;

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
    }

    public async Task<Response> HandleAsync(Query query)
    {
        var tenantId = _tenantContext.TenantId;

        if (tenantId is null)
        {
            throw new ValidationException(
                "Tenant context is required.");
        }

        var patient = await _dbContext.Patients
            .AsNoTracking()
            .Where(x =>
                x.Id == query.Id &&
                x.TenantId == tenantId.Value)
            .Select(x => new Response(
                x.Id,
                x.FirstName,
                x.LastName,
                x.DateOfBirth,
                x.Phone,
                x.Email,
                x.Status,
                x.CreatedAtUtc))
            .SingleOrDefaultAsync();

        if (patient is null)
        {
            throw new ValidationException(
                "Patient not found.");
        }

        return patient;
    }
}

public sealed record Response(
    Guid Id,
    string FirstName,
    string LastName,
    DateOnly DateOfBirth,
    string? Phone,
    string? Email,
    string Status,
    DateTime CreatedAtUtc
);