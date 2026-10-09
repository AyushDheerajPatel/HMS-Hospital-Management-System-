using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Patients.ListPatients;

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

        var page = Math.Max(query.Page, 1);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);

        var patients = _dbContext.Patients
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId.Value);

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var search = query.Search.Trim();

            patients = patients.Where(x =>
                EF.Functions.ILike(
                    x.FirstName,
                    $"%{search}%") ||
                EF.Functions.ILike(
                    x.LastName,
                    $"%{search}%") ||
                (x.Phone != null &&
                 EF.Functions.ILike(
                     x.Phone,
                     $"%{search}%")));
        }

        if (!string.IsNullOrWhiteSpace(query.Status))
        {
            var status = query.Status.Trim().ToLowerInvariant();

            patients = patients.Where(x =>
                x.Status == status);
        }

        var totalCount = await patients.CountAsync();

        var items = await patients
            .OrderBy(x => x.LastName)
            .ThenBy(x => x.FirstName)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new PatientItem(
                x.Id,
                x.FirstName,
                x.LastName,
                x.DateOfBirth,
                x.Phone,
                x.Email,
                x.Status,
                x.CreatedAtUtc))
            .ToListAsync();

        var totalPages = (int)Math.Ceiling(
            totalCount / (double)pageSize);

        return new Response(
            items,
            page,
            pageSize,
            totalCount,
            totalPages);
    }
}

public sealed record PatientItem(
    Guid Id,
    string FirstName,
    string LastName,
    DateOnly DateOfBirth,
    string? Phone,
    string? Email,
    string Status,
    DateTime CreatedAtUtc
);

public sealed record Response(
    IReadOnlyList<PatientItem> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages
);