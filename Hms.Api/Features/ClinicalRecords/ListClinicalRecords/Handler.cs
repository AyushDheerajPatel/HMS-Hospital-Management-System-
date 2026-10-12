using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Infrastructure.MongoDB;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;

namespace Hms.Api.Features.ClinicalRecords.ListClinicalRecords;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly ITenantContext _tenantContext;
    private readonly MongoDbContext _mongoDbContext;

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext,
        MongoDbContext mongoDbContext)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
        _mongoDbContext = mongoDbContext;
    }

    public async Task<IReadOnlyList<ClinicalRecordDocument>> HandleAsync(
        Guid patientId,
        Query query,
        CancellationToken cancellationToken)
    {
        var tenantId = _tenantContext.TenantId;
        if (tenantId is null)
        {
            throw new ValidationException("Tenant context is required.");
        }

        var patientExists = await _dbContext.Patients
            .AnyAsync(
                x => x.Id == patientId && x.TenantId == tenantId.Value,
                cancellationToken);

        if (!patientExists)
        {
            throw new ValidationException("Patient not found.");
        }

        await _mongoDbContext.EnsureIndexesAsync(cancellationToken);
        var page = Math.Max(query.Page, 1);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);
        var filter = Builders<ClinicalRecordDocument>.Filter.And(
            Builders<ClinicalRecordDocument>.Filter.Eq(x => x.TenantId, tenantId.Value),
            Builders<ClinicalRecordDocument>.Filter.Eq(x => x.PatientId, patientId));
        return await _mongoDbContext.ClinicalRecords
            .Find(filter)
            .SortByDescending(x => x.CreatedAtUtc)
            .Skip((page - 1) * pageSize)
            .Limit(pageSize)
            .ToListAsync(cancellationToken);
    }
}

public sealed record Query(int Page = 1, int PageSize = 20);
