namespace Hms.Api.Features.Patients.ListPatients;

public sealed record Query(
    string? Search,
    string? Status,
    int Page = 1,
    int PageSize = 20
);