using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Infrastructure.MongoDB;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;

namespace Hms.Api.Features.ClinicalRecords.CreateClinicalRecord;

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
        Command command,
        CancellationToken cancellationToken)
    {
        var tenantId = _tenantContext.TenantId;

        if (tenantId is null)
        {
            throw new ValidationException(
                "Tenant context is required.");
        }

        ClinicalRecordValidation.Validate(command);

        var patientExists = await _dbContext.Patients
            .AnyAsync(x =>
                x.Id == patientId &&
                x.TenantId == tenantId.Value);

        if (!patientExists)
        {
            throw new ValidationException(
                "Patient not found.");
        }

        await _mongoDbContext.EnsureIndexesAsync(cancellationToken);

        var record = new ClinicalRecordDocument
        {
            TenantId = tenantId.Value,
            PatientId = patientId,
            Diagnosis = command.Diagnosis.Trim(),
            Notes = command.Notes.Trim(),
            Medications = ClinicalRecordValidation.Clean(command.Medications),
            Allergies = ClinicalRecordValidation.Clean(command.Allergies),
            MedicalHistory = command.MedicalHistory?.Trim() ?? string.Empty,
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow
        };

        await _mongoDbContext.ClinicalRecords
            .InsertOneAsync(
                record,
                cancellationToken: cancellationToken);

        return record;
    }
}