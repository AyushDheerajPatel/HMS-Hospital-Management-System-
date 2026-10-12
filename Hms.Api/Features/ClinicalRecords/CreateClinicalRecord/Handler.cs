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

        if (string.IsNullOrWhiteSpace(command.Diagnosis))
        {
            throw new ValidationException(
                "Diagnosis is required.");
        }

        if (command.Diagnosis.Trim().Length > 200)
        {
            throw new ValidationException(
                "Diagnosis must be 200 characters or fewer.");
        }

        if (string.IsNullOrWhiteSpace(command.Notes))
        {
            throw new ValidationException(
                "Clinical notes are required.");
        }

        if (command.Notes.Trim().Length > 5000)
        {
            throw new ValidationException(
                "Notes must be 5000 characters or fewer.");
        }

        if (command.Medications is { Count: > 50 } ||
            command.Medications?.Any(x => x is null || x.Length > 200) == true)
        {
            throw new ValidationException(
                "Provide no more than 50 medications, each 200 characters or fewer.");
        }

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
            Medications = command.Medications?
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .ToList() ?? [],
            CreatedAtUtc = DateTime.UtcNow
        };

        await _mongoDbContext.ClinicalRecords
            .InsertOneAsync(
                record,
                cancellationToken: cancellationToken);

        return record;
    }
}