using Hms.Api.Features.ClinicalRecords.CreateClinicalRecord;
using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Infrastructure.MongoDB;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;

namespace Hms.Api.Features.ClinicalRecords.UpdateClinicalRecord;

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

    public async Task<ClinicalRecordDocument> HandleAsync(
        Guid patientId,
        string recordId,
        Command command,
        CancellationToken cancellationToken)
    {
        var tenantId = _tenantContext.TenantId
            ?? throw new ValidationException("Tenant context is required.");
        ClinicalRecordValidation.Validate(command);

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

        await _mongoDbContext.EnsureIndexesAsync(cancellationToken);
        var filter = Builders<ClinicalRecordDocument>.Filter.And(
            Builders<ClinicalRecordDocument>.Filter.Eq(x => x.Id, recordId),
            Builders<ClinicalRecordDocument>.Filter.Eq(x => x.TenantId, tenantId),
            Builders<ClinicalRecordDocument>.Filter.Eq(x => x.PatientId, patientId));
        var existing = await _mongoDbContext.ClinicalRecords
            .Find(filter)
            .SingleOrDefaultAsync(cancellationToken);
        if (existing is null)
        {
            throw new ValidationException("Clinical record not found.");
        }

        existing.Diagnosis = command.Diagnosis.Trim();
        existing.Notes = command.Notes.Trim();
        existing.Medications = ClinicalRecordValidation.Clean(command.Medications);
        existing.Allergies = ClinicalRecordValidation.Clean(command.Allergies);
        existing.MedicalHistory = command.MedicalHistory?.Trim() ?? string.Empty;
        existing.UpdatedAtUtc = DateTime.UtcNow;

        var replaceResult = await _mongoDbContext.ClinicalRecords.ReplaceOneAsync(
            filter,
            existing,
            cancellationToken: cancellationToken);
        if (replaceResult.MatchedCount == 0)
        {
            throw new ConflictException(
                "This clinical record changed or was deleted. Reload and try again.");
        }

        return existing;
    }
}
