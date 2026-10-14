using Hms.Api.Features.ClinicalRecords.CreateClinicalRecord;
using Hms.Api.Infrastructure.Errors;

namespace Hms.Api.Features.ClinicalRecords;

public static class ClinicalRecordValidation
{
    public static void Validate(Command command)
    {
        if (string.IsNullOrWhiteSpace(command.Diagnosis) ||
            command.Diagnosis.Trim().Length > 200)
        {
            throw new ValidationException(
                "Diagnosis is required and must be 200 characters or fewer.");
        }

        if (string.IsNullOrWhiteSpace(command.Notes) ||
            command.Notes.Trim().Length > 5000)
        {
            throw new ValidationException(
                "Clinical notes are required and must be 5000 characters or fewer.");
        }

        ValidateList(command.Medications, "prescriptions");
        ValidateList(command.Allergies, "allergies");
        if (command.MedicalHistory?.Length > 5000)
        {
            throw new ValidationException(
                "Medical history must be 5000 characters or fewer.");
        }
    }

    public static List<string> Clean(IEnumerable<string>? values) =>
        values?
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .ToList() ?? [];

    private static void ValidateList(
        IReadOnlyCollection<string>? values,
        string label)
    {
        if (values is { Count: > 50 } ||
            values?.Any(value => value is null || value.Trim().Length > 200) == true)
        {
            throw new ValidationException(
                $"Provide no more than 50 {label}, each 200 characters or fewer.");
        }
    }
}
