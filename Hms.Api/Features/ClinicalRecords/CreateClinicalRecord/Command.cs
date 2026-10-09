namespace Hms.Api.Features.ClinicalRecords.CreateClinicalRecord;

public sealed record Command(
    string Diagnosis,
    string Notes,
    List<string>? Medications
);