using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Infrastructure.MongoDB;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;

namespace Hms.Api.Features.ClinicalRecords.DeleteClinicalRecord;

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

    public async Task HandleAsync(
        Guid patientId,
        string recordId,
        CancellationToken cancellationToken)
    {
        var tenantId = _tenantContext.TenantId
            ?? throw new ValidationException("Tenant context is required.");
        if (!Guid.TryParse(recordId, out _))
        {
            throw new ValidationException("Clinical record ID is invalid.");
        }

        var patientExists = await _dbContext.Patients.AnyAsync(
            x => x.Id == patientId && x.TenantId == tenantId,
            cancellationToken);
        if (!patientExists)
        {
            throw new ValidationException("Patient not found.");
        }

        var filter = Builders<ClinicalRecordDocument>.Filter.And(
            Builders<ClinicalRecordDocument>.Filter.Eq(x => x.Id, recordId),
            Builders<ClinicalRecordDocument>.Filter.Eq(x => x.TenantId, tenantId),
            Builders<ClinicalRecordDocument>.Filter.Eq(x => x.PatientId, patientId));
        var result = await _mongoDbContext.ClinicalRecords.DeleteOneAsync(
            filter,
            cancellationToken);
        if (result.DeletedCount == 0)
        {
            throw new ValidationException("Clinical record not found.");
        }
    }
}
